/**
 * In-memory mirror of the relevant Streamlabs Desktop state.
 * Filled by the initial sync after (re)connection, kept up to date by event subscriptions.
 */

import type { SceneModel, SceneNodeMaps, SceneNodeModel } from './slobs/types.js'

export interface SlobsScene {
	id: string
	name: string
}

export type SceneItemDisplay = 'horizontal' | 'vertical'
/** Which copies of a dual output scene item an action or feedback targets */
export type SceneItemDisplayTarget = 'both' | SceneItemDisplay

export interface SlobsSceneItem {
	/** Stable option value used in dropdowns: `${sceneId}::${sceneItemId}` */
	key: string
	sceneId: string
	sceneName: string
	sceneItemId: string
	sourceId: string
	name: string
	visible: boolean
	/** Names of the folders holding the item, outermost first */
	folders: string[]
	/** Always horizontal outside dual output scene collections */
	display: SceneItemDisplay
	/** Key of the copy of this item on the other display, in dual output scene collections */
	partnerKey: string | null
}

export interface SlobsAudioSource {
	sourceId: string
	name: string
	muted: boolean
	/** Companion variable id exposing the mute state of this source */
	variableId: string
}

export interface SlobsCollection {
	id: string
	name: string
}

export interface SlobsPerformance {
	cpu: number
	fps: number
	droppedFrames: number
	droppedFramesPercent: number
}

/** EStreamingState: offline | starting | live | ending | reconnecting */
export type StreamingStatus = string
/** ERecordingState: offline | starting | recording | stopping | writing */
export type RecordingStatus = string

export function sanitizeVariableId(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'source'
}

export function buildSceneItemKey(sceneId: string, sceneItemId: string): string {
	return `${sceneId}::${sceneItemId}`
}

/** API resource of a scene item, e.g. `SceneItem["<sceneId>","<sceneItemId>","<sourceId>"]` */
export function buildSceneItemResource(item: SlobsSceneItem): string {
	return `SceneItem${JSON.stringify([item.sceneId, item.sceneItemId, item.sourceId])}`
}

/** Dropdown label: the folder path tells apart items sharing a name within a scene */
export function sceneItemLabel(item: SlobsSceneItem): string {
	const path = [...item.folders, item.name].join(' / ')
	return `${item.sceneName}: ${path}${item.display === 'vertical' ? ' (vertical)' : ''}`
}

export function parseSceneItemDisplayTarget(value: unknown): SceneItemDisplayTarget {
	return value === 'vertical' || value === 'both' ? value : 'horizontal'
}

export class SlobsState {
	scenes: SlobsScene[] = []
	sceneItems: SlobsSceneItem[] = []
	activeSceneId: string | null = null

	streamingStatus: StreamingStatus = 'offline'
	recordingStatus: RecordingStatus = 'offline'
	replayBufferStatus = 'offline'
	/** ISO date of the last streaming status change, used for the duration timer */
	streamingStatusTime: string | null = null
	recordingStatusTime: string | null = null

	audioSources: SlobsAudioSource[] = []

	collections: SlobsCollection[] = []
	activeCollectionId: string | null = null

	studioMode = false

	performance: SlobsPerformance = { cpu: 0, fps: 0, droppedFrames: 0, droppedFramesPercent: 0 }

	get activeScene(): SlobsScene | undefined {
		if (this.activeSceneId === null) return undefined
		return this.scenes.find((scene) => scene.id === this.activeSceneId)
	}

	get activeCollection(): SlobsCollection | undefined {
		if (this.activeCollectionId === null) return undefined
		return this.collections.find((collection) => collection.id === this.activeCollectionId)
	}

	/** Anything but offline means the stream pipeline is engaged (starting/live/ending/reconnecting) */
	get streamingActive(): boolean {
		return this.streamingStatus !== 'offline'
	}

	get recordingActive(): boolean {
		return this.recordingStatus !== 'offline'
	}

	get replayBufferActive(): boolean {
		return this.replayBufferStatus !== 'offline'
	}

	/** Extract scenes and their items (folders flattened away) from full scene models.
	 * The dual output node maps pair the horizontal and vertical copies of each item. */
	setScenes(scenes: SceneModel[], nodeMaps: SceneNodeMaps = {}): void {
		this.scenes = scenes.map((scene) => ({ id: scene.id, name: scene.name }))
		this.sceneItems = scenes.flatMap((scene) => {
			const nodes = scene.nodes ?? []
			const folders = new Map(nodes.filter((node) => node.sceneNodeType === 'folder').map((node) => [node.id, node]))
			// Membership is carried by the child's parentId and/or the folder's childrenIds
			const parentIds = new Map<string, string>()
			for (const folder of folders.values()) {
				for (const childId of folder.childrenIds ?? []) parentIds.set(childId, folder.id)
			}
			const folderPath = (node: SceneNodeModel): string[] => {
				const path: string[] = []
				let folder = folders.get(node.parentId || parentIds.get(node.id) || '')
				// The depth bound guards against a malformed, cyclic tree
				while (folder && path.length < folders.size) {
					path.unshift(folder.name?.trim() || folder.id)
					folder = folders.get(folder.parentId || parentIds.get(folder.id) || '')
				}
				return path
			}

			const byNodeId = new Map<string, SlobsSceneItem>()
			for (const node of nodes) {
				if (node.sceneNodeType !== 'item' || !node.sceneItemId || !node.sourceId) continue
				byNodeId.set(node.id, {
					key: buildSceneItemKey(scene.id, node.sceneItemId),
					sceneId: scene.id,
					sceneName: scene.name,
					sceneItemId: node.sceneItemId,
					sourceId: node.sourceId,
					name: node.name ?? node.sceneItemId,
					visible: node.visible ?? true,
					folders: folderPath(node),
					display: node.display === 'vertical' ? 'vertical' : 'horizontal',
					partnerKey: null,
				})
			}

			for (const [horizontalId, verticalId] of Object.entries(nodeMaps[scene.id] ?? {})) {
				const horizontal = byNodeId.get(horizontalId)
				const vertical = byNodeId.get(verticalId)
				if (horizontal?.display !== 'horizontal' || vertical?.display !== 'vertical') continue
				horizontal.partnerKey = vertical.key
				vertical.partnerKey = horizontal.key
			}
			return [...byNodeId.values()]
		})
	}

	/** Items offered in dropdowns: a dual output pair is listed once, through its horizontal copy */
	get selectableSceneItems(): SlobsSceneItem[] {
		return this.sceneItems.filter((item) => item.display === 'horizontal' || item.partnerKey === null)
	}

	setActiveScene(sceneId: string | null): void {
		this.activeSceneId = sceneId
	}

	findSceneByName(name: string, ignoreCase = false): SlobsScene | undefined {
		if (!ignoreCase) return this.scenes.find((scene) => scene.name === name)
		const lowered = name.toLowerCase()
		return this.scenes.find((scene) => scene.name.toLowerCase() === lowered)
	}

	findSceneItem(key: string): SlobsSceneItem | undefined {
		return this.sceneItems.find((item) => item.key === key)
	}

	/** Copies of an item to target, the selected one first. The display only filters dual output pairs:
	 * an item that exists on a single display always resolves to itself. */
	resolveSceneItems(key: string, display: SceneItemDisplayTarget): SlobsSceneItem[] {
		const item = this.findSceneItem(key)
		if (!item) return []
		const partner = item.partnerKey === null ? undefined : this.findSceneItem(item.partnerKey)
		if (!partner) return [item]
		if (display === 'both') return [item, partner]
		return [item, partner].filter((copy) => copy.display === display)
	}

	/** Returns the updated item when it is known and the visibility changed */
	applyItemVisibility(sceneId: string, sceneItemId: string, visible: boolean): SlobsSceneItem | undefined {
		const item = this.findSceneItem(buildSceneItemKey(sceneId, sceneItemId))
		if (!item || item.visible === visible) return undefined
		item.visible = visible
		return item
	}

	/** Replace the audio source list, assigning a unique Companion variable id per source.
	 * Colliding names are suffixed with the stable sourceId, so an id never designates a
	 * different source after a resync reorders or shrinks the list. */
	setAudioSources(sources: Array<{ sourceId: string; name: string; muted: boolean }>): void {
		const baseCounts = new Map<string, number>()
		for (const source of sources) {
			const base = `mute_${sanitizeVariableId(source.name)}`
			baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
		}

		const usedIds = new Set<string>()
		this.audioSources = sources.map((source) => {
			const base = `mute_${sanitizeVariableId(source.name)}`
			let variableId = (baseCounts.get(base) ?? 0) > 1 ? `${base}_${sanitizeVariableId(source.sourceId)}` : base
			while (usedIds.has(variableId)) variableId += '_'
			usedIds.add(variableId)
			return { ...source, variableId }
		})
	}

	findAudioSource(sourceId: string): SlobsAudioSource | undefined {
		return this.audioSources.find((source) => source.sourceId === sourceId)
	}

	/** Returns the updated source when it is known and the mute state changed */
	applySourceMuted(sourceId: string, muted: boolean): SlobsAudioSource | undefined {
		const source = this.findAudioSource(sourceId)
		if (!source || source.muted === muted) return undefined
		source.muted = muted
		return source
	}

	setCollections(collections: SlobsCollection[], activeCollectionId: string | null): void {
		this.collections = collections
		this.activeCollectionId = activeCollectionId
	}

	clear(): void {
		this.scenes = []
		this.sceneItems = []
		this.activeSceneId = null
		this.streamingStatus = 'offline'
		this.recordingStatus = 'offline'
		this.replayBufferStatus = 'offline'
		this.streamingStatusTime = null
		this.recordingStatusTime = null
		this.audioSources = []
		this.collections = []
		this.activeCollectionId = null
		this.studioMode = false
		this.performance = { cpu: 0, fps: 0, droppedFrames: 0, droppedFramesPercent: 0 }
	}
}
