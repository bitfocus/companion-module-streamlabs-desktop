/**
 * In-memory mirror of the relevant Streamlabs Desktop state.
 * Filled by the initial sync after (re)connection, kept up to date by event subscriptions.
 */

import type { SceneModel } from './slobs/types.js'

export interface SlobsScene {
	id: string
	name: string
}

export interface SlobsSceneItem {
	/** Stable option value used in dropdowns: `${sceneId}::${sceneItemId}` */
	key: string
	sceneId: string
	sceneName: string
	sceneItemId: string
	sourceId: string
	name: string
	visible: boolean
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

	/** Extract scenes and their items (folders flattened away) from full scene models */
	setScenes(scenes: SceneModel[]): void {
		this.scenes = scenes.map((scene) => ({ id: scene.id, name: scene.name }))
		this.sceneItems = scenes.flatMap((scene) =>
			(scene.nodes ?? [])
				.filter((node) => node.sceneNodeType === 'item' && node.sceneItemId && node.sourceId)
				.map((node) => ({
					key: buildSceneItemKey(scene.id, node.sceneItemId as string),
					sceneId: scene.id,
					sceneName: scene.name,
					sceneItemId: node.sceneItemId as string,
					sourceId: node.sourceId as string,
					name: node.name ?? (node.sceneItemId as string),
					visible: node.visible ?? true,
				})),
		)
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

	/** Returns the updated item when it is known and the visibility changed */
	applyItemVisibility(sceneId: string, sceneItemId: string, visible: boolean): SlobsSceneItem | undefined {
		const item = this.findSceneItem(buildSceneItemKey(sceneId, sceneItemId))
		if (!item || item.visible === visible) return undefined
		item.visible = visible
		return item
	}

	/** Replace the audio source list, assigning a unique Companion variable id per source */
	setAudioSources(sources: Array<{ sourceId: string; name: string; muted: boolean }>): void {
		const usedIds = new Set<string>()
		this.audioSources = sources.map((source) => {
			let variableId = `mute_${sanitizeVariableId(source.name)}`
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
