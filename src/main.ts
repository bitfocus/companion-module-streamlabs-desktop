import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { CONFIG_DEFAULTS, GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { SlobsConnection } from './slobs/connection.js'
import type {
	AudioSourceModel,
	CollectionModel,
	PerformanceModel,
	SceneModel,
	SceneNodeModel,
	SourceModel,
	StreamingModel,
	TransitionsModel,
} from './slobs/types.js'
import { SlobsState } from './state.js'
import { extractStatus, formatDuration } from './util.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

/** Consecutive failed connection attempts before reporting ConnectionFailure instead of Disconnected */
const CONNECTION_FAILURE_THRESHOLD = 3

/** Debounce window for full re-syncs triggered by bursts of events (e.g. scene collection switch) */
const RESYNC_DEBOUNCE_MS = 250

/** Base tick for duration timers; performance is polled every other tick */
const TICK_INTERVAL_MS = 1000

/** Statuses documented by the API; anything else is accepted but logged once for support */
const KNOWN_STATUSES: Record<string, string[]> = {
	streaming: ['offline', 'starting', 'live', 'ending', 'reconnecting'],
	recording: ['offline', 'starting', 'recording', 'stopping', 'writing'],
	replay_buffer: ['offline', 'running', 'stopping', 'saving'],
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	secrets!: ModuleSecrets // Setup in init()

	readonly state = new SlobsState()
	connection: SlobsConnection | null = null

	#sceneResyncTimer: NodeJS.Timeout | null = null
	#audioResyncTimer: NodeJS.Timeout | null = null
	#collectionResyncTimer: NodeJS.Timeout | null = null
	#tickTimer: NodeJS.Timeout | null = null
	#tickCount = 0
	readonly #warnedStatuses = new Set<string>()

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets | undefined): Promise<void> {
		this.config = { ...CONFIG_DEFAULTS, ...config }
		this.secrets = { token: '', ...secrets }

		this.refreshDefinitions()
		this.#initConnection()
	}

	// When module gets deleted
	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
		this.#teardownConnection()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets | undefined): Promise<void> {
		this.config = { ...CONFIG_DEFAULTS, ...config }
		this.secrets = { token: '', ...secrets }

		this.#teardownConnection()
		this.#initConnection()
	}

	// Return config fields for web config
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	#initConnection(): void {
		if (!this.config.host || !this.config.port) {
			this.updateStatus(InstanceStatus.BadConfig, 'Host and port are required')
			return
		}
		if (!this.secrets.token) {
			this.updateStatus(
				InstanceStatus.BadConfig,
				'API token is missing (Streamlabs Desktop > Settings > Remote Control)',
			)
			return
		}

		this.updateStatus(InstanceStatus.Connecting)

		const connection = new SlobsConnection({
			host: this.config.host,
			port: this.config.port,
			token: this.secrets.token,
		})
		this.connection = connection

		connection.on('log', (level, message) => this.log(level, message))

		connection.on('connecting', () => {
			this.updateStatus(InstanceStatus.Connecting)
		})

		connection.on('connected', () => {
			void this.#onConnected(connection)
		})

		connection.on('disconnected', (reason, failedAttempts) => {
			this.#stopTick()
			if (failedAttempts >= CONNECTION_FAILURE_THRESHOLD) {
				this.updateStatus(InstanceStatus.ConnectionFailure, reason)
			} else {
				this.updateStatus(InstanceStatus.Disconnected, reason)
			}
		})

		connection.on('authFailed', () => {
			this.updateStatus(InstanceStatus.AuthenticationFailure, 'Streamlabs Desktop rejected the API token')
		})

		connection.start()
	}

	#teardownConnection(): void {
		this.#stopTick()
		for (const timer of [this.#sceneResyncTimer, this.#audioResyncTimer, this.#collectionResyncTimer]) {
			if (timer) clearTimeout(timer)
		}
		this.#sceneResyncTimer = null
		this.#audioResyncTimer = null
		this.#collectionResyncTimer = null

		if (this.connection) {
			this.connection.removeAllListeners()
			this.connection.destroy()
			this.connection = null
		}
		this.state.clear()
	}

	/** Subscriptions and initial state sync, run after every successful (re)connection */
	async #onConnected(connection: SlobsConnection): Promise<void> {
		try {
			// Arm the event subscriptions first so no change is missed while syncing
			await connection.subscribe('ScenesService', 'sceneSwitched', (data) => {
				this.#onSceneSwitched(data as SceneModel)
			})
			await connection.subscribe('ScenesService', 'sceneAdded', () => this.#scheduleSceneResync())
			await connection.subscribe('ScenesService', 'sceneRemoved', () => this.#scheduleSceneResync())
			await connection.subscribe('ScenesService', 'itemAdded', () => this.#scheduleSceneResync())
			await connection.subscribe('ScenesService', 'itemRemoved', () => this.#scheduleSceneResync())
			await connection.subscribe('ScenesService', 'itemUpdated', (data) => {
				this.#onItemUpdated(data as SceneNodeModel)
			})
			await connection.subscribe('StreamingService', 'streamingStatusChange', (data) => {
				this.#onStreamingStatusChange(data)
			})
			await connection.subscribe('StreamingService', 'recordingStatusChange', (data) => {
				this.#onRecordingStatusChange(data)
			})
			await connection.subscribe('StreamingService', 'replayBufferStatusChange', (data) => {
				this.#onReplayBufferStatusChange(data)
			})
			await connection.subscribe('SourcesService', 'sourceUpdated', (data) => {
				this.#onSourceUpdated(data as SourceModel)
			})
			await connection.subscribe('SceneCollectionsService', 'collectionSwitched', (data) => {
				this.#onCollectionSwitched(data as CollectionModel)
			})
			await connection.subscribe('SceneCollectionsService', 'collectionAdded', () => this.#scheduleCollectionResync())
			await connection.subscribe('SceneCollectionsService', 'collectionRemoved', () => this.#scheduleCollectionResync())
			await connection.subscribe('SceneCollectionsService', 'collectionUpdated', () => this.#scheduleCollectionResync())
			await connection.subscribe('TransitionsService', 'studioModeChanged', (data) => {
				this.#onStudioModeChanged(data)
			})

			await this.#syncState(connection)

			// The connection may have dropped while we were syncing
			if (this.connection !== connection || !connection.isConnected) return

			this.updateStatus(InstanceStatus.Ok)
			this.#startTick()
			this.log(
				'info',
				`Connected to Streamlabs Desktop: ${this.state.scenes.length} scene(s), ${this.state.sceneItems.length} scene item(s), ` +
					`active scene "${this.state.activeScene?.name ?? 'unknown'}", collection "${this.state.activeCollection?.name ?? 'unknown'}", ` +
					`streaming ${this.state.streamingStatus}, recording ${this.state.recordingStatus}, replay buffer ${this.state.replayBufferStatus}, ` +
					`${this.state.audioSources.length} audio source(s)`,
			)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.log('error', `Initial state sync failed: ${message}`)
			this.updateStatus(InstanceStatus.UnknownError, `State sync failed: ${message}`)
		}
	}

	/** Full fetch of everything we mirror, then refresh all definitions, variables and feedbacks */
	async #syncState(connection: SlobsConnection): Promise<void> {
		const scenes = await connection.request<SceneModel[]>('ScenesService', 'getScenes')
		const activeSceneId = await connection.request<string>('ScenesService', 'activeSceneId')
		const streamingModel = await connection.request<StreamingModel>('StreamingService', 'getModel')
		const audioSources = await this.#fetchAudioSources(connection)
		const collections = await connection.request<CollectionModel[]>('SceneCollectionsService', 'collections')
		const activeCollection = await connection.request<CollectionModel>('SceneCollectionsService', 'activeCollection')
		const transitions = await connection.request<TransitionsModel>('TransitionsService', 'getModel')

		this.state.setScenes(scenes)
		this.state.setActiveScene(activeSceneId)
		this.#applyStreamingModel(streamingModel)
		this.state.setAudioSources(
			audioSources.map((source) => ({ sourceId: source.sourceId, name: source.name, muted: source.muted })),
		)
		this.state.setCollections(
			collections.map((collection) => ({ id: collection.id, name: collection.name })),
			activeCollection?.id ?? null,
		)
		this.state.studioMode = transitions.studioMode

		if (this.config.enablePerformance) await this.#pollPerformance(connection)

		this.refreshDefinitions()
		this.refreshAllVariables()
		this.checkFeedbacks(
			'scene_active',
			'streaming_active',
			'recording_active',
			'audio_muted',
			'item_visible',
			'collection_active',
			'replay_buffer_active',
			'studio_mode_active',
			'dropped_frames_above',
		)
	}

	async #fetchAudioSources(connection: SlobsConnection): Promise<AudioSourceModel[]> {
		const method = this.config.audioScope === 'current_scene' ? 'getSourcesForCurrentScene' : 'getSources'
		return connection.request<AudioSourceModel[]>('AudioService', method)
	}

	#applyStreamingModel(model: StreamingModel): void {
		this.state.streamingStatus = model.streamingStatus
		this.state.recordingStatus = model.recordingStatus
		this.state.replayBufferStatus = model.replayBufferStatus ?? 'offline'
		this.state.streamingStatusTime = model.streamingStatusTime ?? null
		this.state.recordingStatusTime = model.recordingStatusTime ?? null
	}

	// ---------------------------------------------------------------------------
	// Duration timers and performance polling
	// ---------------------------------------------------------------------------

	#startTick(): void {
		this.#stopTick()
		this.#tickCount = 0
		this.#tickTimer = setInterval(() => {
			this.#tickCount += 1
			this.#updateDurations()
			if (this.config.enablePerformance && this.#tickCount % 2 === 0) {
				const connection = this.connection
				if (connection?.isConnected) {
					void this.#pollPerformance(connection).then(() => {
						this.#publishPerformance()
					})
				}
			}
		}, TICK_INTERVAL_MS)
	}

	#stopTick(): void {
		if (this.#tickTimer) {
			clearInterval(this.#tickTimer)
			this.#tickTimer = null
		}
	}

	#updateDurations(): void {
		this.setVariableValues({
			stream_duration: this.#durationSince(this.state.streamingActive, this.state.streamingStatusTime),
			recording_duration: this.#durationSince(this.state.recordingActive, this.state.recordingStatusTime),
		})
	}

	#durationSince(active: boolean, statusTime: string | null): string {
		if (!active || !statusTime) return '00:00:00'
		const started = Date.parse(statusTime)
		if (Number.isNaN(started)) return '00:00:00'
		return formatDuration(Date.now() - started)
	}

	async #pollPerformance(connection: SlobsConnection): Promise<void> {
		try {
			const model = await connection.request<PerformanceModel>('PerformanceService', 'getModel')
			this.state.performance = {
				cpu: Math.round(model.CPU * 10) / 10,
				fps: Math.round(model.frameRate),
				droppedFrames: model.numberDroppedFrames,
				droppedFramesPercent: Math.round(model.percentageDroppedFrames * 100) / 100,
			}
		} catch (error) {
			this.log('debug', `Performance poll failed: ${String(error)}`)
		}
	}

	#publishPerformance(): void {
		this.setVariableValues({
			cpu_usage: this.state.performance.cpu,
			fps: this.state.performance.fps,
			dropped_frames: this.state.performance.droppedFrames,
			dropped_frames_percent: this.state.performance.droppedFramesPercent,
		})
		this.checkFeedbacks('dropped_frames_above')
	}

	// ---------------------------------------------------------------------------
	// Event handlers
	// ---------------------------------------------------------------------------

	#onSceneSwitched(scene: SceneModel): void {
		this.state.setActiveScene(scene.id)
		this.log('debug', `Scene switched to "${scene.name}"`)
		this.setVariableValues({
			current_scene: scene.name,
			current_scene_id: scene.id,
		})
		this.checkFeedbacks('scene_active')
		// Scene-specific audio sources may have appeared or disappeared
		if (this.config.audioScope === 'current_scene') this.#scheduleAudioResync()
	}

	#onItemUpdated(node: SceneNodeModel | null): void {
		if (node && node.sceneId && node.sceneItemId && typeof node.visible === 'boolean') {
			const updated = this.state.applyItemVisibility(node.sceneId, node.sceneItemId, node.visible)
			if (updated) {
				this.log('debug', `Scene item "${updated.name}" is now ${updated.visible ? 'visible' : 'hidden'}`)
				this.checkFeedbacks('item_visible')
				return
			}
			if (this.state.findSceneItem(`${node.sceneId}::${node.sceneItemId}`)) return // known, unchanged
		}
		// Unknown item or partial payload: refresh the scene list (debounced)
		this.#scheduleSceneResync()
	}

	#scheduleSceneResync(): void {
		if (this.#sceneResyncTimer) clearTimeout(this.#sceneResyncTimer)
		this.#sceneResyncTimer = setTimeout(() => {
			this.#sceneResyncTimer = null
			void this.#resyncScenes()
		}, RESYNC_DEBOUNCE_MS)
	}

	async #resyncScenes(): Promise<void> {
		const connection = this.connection
		if (!connection || !connection.isConnected) return
		try {
			const scenes = await connection.request<SceneModel[]>('ScenesService', 'getScenes')
			const activeSceneId = await connection.request<string>('ScenesService', 'activeSceneId')
			this.state.setScenes(scenes)
			this.state.setActiveScene(activeSceneId)
			this.log(
				'debug',
				`Scene list resynced: ${this.state.scenes.length} scene(s), ${this.state.sceneItems.length} item(s)`,
			)
			this.refreshDefinitions()
			this.refreshAllVariables()
			this.checkFeedbacks('scene_active', 'item_visible')
		} catch (error) {
			this.log('warn', `Scene list resync failed: ${String(error)}`)
		}
	}

	#scheduleAudioResync(): void {
		if (this.#audioResyncTimer) clearTimeout(this.#audioResyncTimer)
		this.#audioResyncTimer = setTimeout(() => {
			this.#audioResyncTimer = null
			void this.#resyncAudioSources()
		}, RESYNC_DEBOUNCE_MS)
	}

	async #resyncAudioSources(): Promise<void> {
		const connection = this.connection
		if (!connection || !connection.isConnected) return
		try {
			const audioSources = await this.#fetchAudioSources(connection)
			this.state.setAudioSources(
				audioSources.map((source) => ({ sourceId: source.sourceId, name: source.name, muted: source.muted })),
			)
			this.refreshDefinitions()
			this.refreshAllVariables()
			this.checkFeedbacks('audio_muted')
		} catch (error) {
			this.log('warn', `Audio source resync failed: ${String(error)}`)
		}
	}

	#scheduleCollectionResync(): void {
		if (this.#collectionResyncTimer) clearTimeout(this.#collectionResyncTimer)
		this.#collectionResyncTimer = setTimeout(() => {
			this.#collectionResyncTimer = null
			void this.#resyncCollections()
		}, RESYNC_DEBOUNCE_MS)
	}

	async #resyncCollections(): Promise<void> {
		const connection = this.connection
		if (!connection || !connection.isConnected) return
		try {
			const collections = await connection.request<CollectionModel[]>('SceneCollectionsService', 'collections')
			const activeCollection = await connection.request<CollectionModel>('SceneCollectionsService', 'activeCollection')
			this.state.setCollections(
				collections.map((collection) => ({ id: collection.id, name: collection.name })),
				activeCollection?.id ?? null,
			)
			this.refreshDefinitions()
			this.refreshAllVariables()
			this.checkFeedbacks('collection_active')
		} catch (error) {
			this.log('warn', `Collection resync failed: ${String(error)}`)
		}
	}

	#onCollectionSwitched(collection: CollectionModel | null): void {
		this.log('info', `Scene collection switched to "${collection?.name ?? 'unknown'}"`)
		if (collection?.id) this.state.activeCollectionId = collection.id
		this.checkFeedbacks('collection_active')
		// A collection switch replaces scenes, items and sources wholesale
		this.#scheduleSceneResync()
		this.#scheduleAudioResync()
		this.#scheduleCollectionResync()
	}

	#onStreamingStatusChange(data: unknown): void {
		const status = extractStatus(data, 'streamingStatus')
		if (!status) {
			this.log('debug', `Unrecognized streamingStatusChange payload: ${JSON.stringify(data)}`)
			return
		}
		this.#warnUnknownStatus('streaming', status)
		this.state.streamingStatus = status
		this.state.streamingStatusTime = new Date().toISOString()
		this.log('info', `Streaming status: ${status}`)
		this.setVariableValues({
			streaming: this.state.streamingActive,
			streaming_status: status,
		})
		this.#updateDurations()
		this.checkFeedbacks('streaming_active')
	}

	#onRecordingStatusChange(data: unknown): void {
		const status = extractStatus(data, 'recordingStatus')
		if (!status) {
			this.log('debug', `Unrecognized recordingStatusChange payload: ${JSON.stringify(data)}`)
			return
		}
		this.#warnUnknownStatus('recording', status)
		this.state.recordingStatus = status
		this.state.recordingStatusTime = new Date().toISOString()
		this.log('info', `Recording status: ${status}`)
		this.setVariableValues({
			recording: this.state.recordingActive,
			recording_status: status,
		})
		this.#updateDurations()
		this.checkFeedbacks('recording_active')
	}

	#onReplayBufferStatusChange(data: unknown): void {
		const status = extractStatus(data, 'replayBufferStatus')
		if (!status) {
			this.log('debug', `Unrecognized replayBufferStatusChange payload: ${JSON.stringify(data)}`)
			return
		}
		this.#warnUnknownStatus('replay_buffer', status)
		this.state.replayBufferStatus = status
		this.log('info', `Replay buffer status: ${status}`)
		this.setVariableValues({
			replay_buffer: this.state.replayBufferActive,
			replay_buffer_status: status,
		})
		this.checkFeedbacks('replay_buffer_active')
	}

	#onStudioModeChanged(data: unknown): void {
		const enabled =
			typeof data === 'boolean'
				? data
				: typeof data === 'object' && data !== null
					? Boolean((data as Record<string, unknown>).studioMode)
					: null
		if (enabled === null) return
		this.state.studioMode = enabled
		this.log('info', `Studio mode ${enabled ? 'enabled' : 'disabled'}`)
		this.setVariableValues({ studio_mode: enabled })
		this.checkFeedbacks('studio_mode_active')
	}

	#onSourceUpdated(source: SourceModel): void {
		if (typeof source.muted === 'boolean') {
			const updated = this.state.applySourceMuted(source.sourceId, source.muted)
			if (updated) {
				this.log('debug', `Audio source "${updated.name}" ${updated.muted ? 'muted' : 'unmuted'}`)
				this.setVariableValues({ [updated.variableId]: updated.muted })
				this.checkFeedbacks('audio_muted')
				return
			}
		}
		// A rename or an unknown source: refresh the list (debounced)
		if (source.name !== undefined || !this.state.findAudioSource(source.sourceId)) {
			this.#scheduleAudioResync()
		}
	}

	#warnUnknownStatus(domain: string, status: string): void {
		if (KNOWN_STATUSES[domain]?.includes(status)) return
		const key = `${domain}:${status}`
		if (this.#warnedStatuses.has(key)) return
		this.#warnedStatuses.add(key)
		this.log('info', `Streamlabs reported an undocumented ${domain} status "${status}" (handled, but worth reporting)`)
	}

	// ---------------------------------------------------------------------------
	// Streamlabs commands used by actions
	// ---------------------------------------------------------------------------

	/** Returns the active connection or logs why an action cannot run */
	getConnectionForAction(actionName: string): SlobsConnection | null {
		const connection = this.connection
		if (!connection || !connection.isConnected) {
			this.log('warn', `Cannot run "${actionName}": not connected to Streamlabs Desktop`)
			return null
		}
		return connection
	}

	async setSceneActive(sceneId: string): Promise<void> {
		const connection = this.getConnectionForAction('set scene')
		if (!connection) return
		const changed = await connection.request<boolean>('ScenesService', 'makeSceneActive', sceneId)
		if (changed === false) this.log('warn', `Scene ${sceneId} was not found in Streamlabs Desktop`)
	}

	async setSceneActiveByName(name: string, ignoreCase: boolean): Promise<void> {
		const connection = this.getConnectionForAction('set scene by name')
		if (!connection) return

		let scene = this.state.findSceneByName(name, ignoreCase)
		if (!scene) {
			// The local mirror may be stale: refetch once before giving up
			await this.#resyncScenes()
			scene = this.state.findSceneByName(name, ignoreCase)
		}
		if (!scene) {
			this.log('error', `Scene named "${name}" was not found in Streamlabs Desktop`)
			return
		}
		await connection.request('ScenesService', 'makeSceneActive', scene.id)
	}

	/**
	 * The API only exposes toggleStreaming / toggleRecording. For explicit start/stop we
	 * refetch the current status first so a stale mirror can never invert the intent.
	 */
	async setStreamingActive(desired: boolean | 'toggle'): Promise<void> {
		if (this.config.lockStreaming) {
			this.log('warn', 'Streaming action ignored: the safety lock is enabled in the module configuration')
			return
		}
		const connection = this.getConnectionForAction(desired === 'toggle' ? 'toggle streaming' : 'set streaming')
		if (!connection) return

		if (desired !== 'toggle') {
			const model = await connection.request<StreamingModel>('StreamingService', 'getModel')
			this.#applyStreamingModel(model)
			if (this.state.streamingActive === desired) {
				this.log('debug', `Streaming already ${model.streamingStatus}, nothing to do`)
				return
			}
		}
		await connection.request('StreamingService', 'toggleStreaming')
	}

	async setRecordingActive(desired: boolean | 'toggle'): Promise<void> {
		const connection = this.getConnectionForAction(desired === 'toggle' ? 'toggle recording' : 'set recording')
		if (!connection) return

		if (desired !== 'toggle') {
			const model = await connection.request<StreamingModel>('StreamingService', 'getModel')
			this.#applyStreamingModel(model)
			if (this.state.recordingActive === desired) {
				this.log('debug', `Recording already ${model.recordingStatus}, nothing to do`)
				return
			}
		}
		await connection.request('StreamingService', 'toggleRecording')
	}

	async setReplayBufferActive(desired: boolean | 'toggle'): Promise<void> {
		const connection = this.getConnectionForAction('replay buffer')
		if (!connection) return

		let start: boolean
		if (desired === 'toggle') {
			const model = await connection.request<StreamingModel>('StreamingService', 'getModel')
			this.#applyStreamingModel(model)
			start = !this.state.replayBufferActive
		} else {
			const model = await connection.request<StreamingModel>('StreamingService', 'getModel')
			this.#applyStreamingModel(model)
			if (this.state.replayBufferActive === desired) {
				this.log('debug', `Replay buffer already ${this.state.replayBufferStatus}, nothing to do`)
				return
			}
			start = desired
		}
		await connection.request('StreamingService', start ? 'startReplayBuffer' : 'stopReplayBuffer')
	}

	async saveReplay(): Promise<void> {
		const connection = this.getConnectionForAction('save replay')
		if (!connection) return
		if (!this.state.replayBufferActive) {
			this.log('warn', 'Cannot save replay: the replay buffer is not running')
			return
		}
		await connection.request('StreamingService', 'saveReplay')
	}

	async setSourceMuted(sourceId: string, desired: boolean | 'toggle'): Promise<void> {
		const connection = this.getConnectionForAction('audio mute')
		if (!connection) return

		const source = this.state.findAudioSource(sourceId)
		if (!source) {
			this.log('error', `Audio source ${sourceId} is not known (removed, renamed or out of scope?)`)
			return
		}
		const muted = desired === 'toggle' ? !source.muted : desired

		// Documented resource method; SourcesService.setMuted is the legacy spelling used by the
		// official web example and is kept as a fallback for older Streamlabs versions.
		try {
			await connection.request(`AudioSource["${sourceId}"]`, 'setMuted', muted)
		} catch (error) {
			this.log('debug', `AudioSource.setMuted failed (${String(error)}), trying SourcesService.setMuted`)
			await connection.request('SourcesService', 'setMuted', sourceId, muted)
		}
	}

	async setSceneItemVisible(itemKey: string, desired: boolean | 'toggle'): Promise<void> {
		const connection = this.getConnectionForAction('scene item visibility')
		if (!connection) return

		const item = this.state.findSceneItem(itemKey)
		if (!item) {
			this.log('error', `Scene item ${itemKey} is not known (removed or scene changed?)`)
			return
		}
		const visible = desired === 'toggle' ? !item.visible : desired
		const resource = `SceneItem["${item.sceneId}","${item.sceneItemId}","${item.sourceId}"]`
		await connection.request(resource, 'setVisibility', visible)
	}

	async setCollectionActive(collectionId: string): Promise<void> {
		const connection = this.getConnectionForAction('set scene collection')
		if (!connection) return
		if (this.state.activeCollectionId === collectionId) {
			this.log('debug', 'Scene collection already active, nothing to do')
			return
		}
		this.log('info', 'Switching scene collection (this reloads all scenes and sources)')
		await connection.request('SceneCollectionsService', 'load', collectionId)
	}

	async setStudioMode(desired: boolean | 'toggle'): Promise<void> {
		const connection = this.getConnectionForAction('studio mode')
		if (!connection) return

		const target = desired === 'toggle' ? !this.state.studioMode : desired
		await connection.request('TransitionsService', target ? 'enableStudioMode' : 'disableStudioMode')

		// Streamlabs silently refuses studio mode in some setups (e.g. dual output enabled),
		// so refetch instead of trusting the studioModeChanged event to fire
		const model = await connection.request<TransitionsModel>('TransitionsService', 'getModel')
		if (model.studioMode !== target) {
			this.log(
				'warn',
				`Streamlabs Desktop did not ${target ? 'enable' : 'disable'} studio mode (unsupported with dual output enabled)`,
			)
		}
		if (model.studioMode !== this.state.studioMode) {
			this.state.studioMode = model.studioMode
			this.setVariableValues({ studio_mode: model.studioMode })
			this.checkFeedbacks('studio_mode_active')
		}
	}

	async executeStudioTransition(): Promise<void> {
		const connection = this.getConnectionForAction('studio transition')
		if (!connection) return
		if (!this.state.studioMode) {
			this.log('warn', 'Cannot execute the studio transition: studio mode is not enabled')
			return
		}
		await connection.request('TransitionsService', 'executeStudioModeTransition')
	}

	// ---------------------------------------------------------------------------
	// Definitions and variables plumbing
	// ---------------------------------------------------------------------------

	/** Re-publish actions/feedbacks/presets/variable definitions (dropdown choices depend on state) */
	refreshDefinitions(): void {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdatePresets(this)
		UpdateVariableDefinitions(this)
	}

	refreshAllVariables(): void {
		const values: Partial<VariablesSchema> = {
			current_scene: this.state.activeScene?.name ?? '',
			current_scene_id: this.state.activeSceneId ?? '',
			current_collection: this.state.activeCollection?.name ?? '',
			streaming: this.state.streamingActive,
			streaming_status: this.state.streamingStatus,
			recording: this.state.recordingActive,
			recording_status: this.state.recordingStatus,
			replay_buffer: this.state.replayBufferActive,
			replay_buffer_status: this.state.replayBufferStatus,
			studio_mode: this.state.studioMode,
			stream_duration: this.#durationSince(this.state.streamingActive, this.state.streamingStatusTime),
			recording_duration: this.#durationSince(this.state.recordingActive, this.state.recordingStatusTime),
			cpu_usage: this.state.performance.cpu,
			fps: this.state.performance.fps,
			dropped_frames: this.state.performance.droppedFrames,
			dropped_frames_percent: this.state.performance.droppedFramesPercent,
		}
		for (const source of this.state.audioSources) {
			values[source.variableId] = source.muted
		}
		this.setVariableValues(values)
	}
}
