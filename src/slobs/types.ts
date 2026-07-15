/**
 * Types for the Streamlabs Desktop remote control protocol.
 * JSON-RPC 2.0 over SockJS, documented at
 * https://streamlabs.github.io/streamlabs-desktop-api-docs/docs/index.html
 */

export interface JsonRpcRequest {
	jsonrpc: '2.0'
	id: number
	method: string
	params: {
		resource: string
		args?: unknown[]
	}
}

export interface JsonRpcError {
	code: number
	message: string
}

export interface JsonRpcResponse {
	jsonrpc: '2.0'
	id: number | null
	result?: unknown
	error?: JsonRpcError
}

/**
 * Returned when calling an event channel method (subscription) or an async service method (promise).
 * - emitter 'STREAM': events will be emitted for this resourceId until unsubscribed
 * - emitter 'PROMISE': a single EVENT will follow, resolving or rejecting the call
 */
export interface SubscriptionResult {
	_type: 'SUBSCRIPTION'
	resourceId: string
	emitter: 'STREAM' | 'PROMISE'
}

export interface EventResult {
	_type: 'EVENT'
	resourceId: string
	emitter: 'STREAM' | 'PROMISE'
	data: unknown
	isRejected?: boolean
}

export function isSubscriptionResult(result: unknown): result is SubscriptionResult {
	return isRecord(result) && result._type === 'SUBSCRIPTION'
}

export function isEventResult(result: unknown): result is EventResult {
	return isRecord(result) && result._type === 'EVENT'
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/** Scene model as returned by ScenesService.getScenes / activeScene / sceneSwitched */
export interface SceneModel {
	id: string
	name: string
	resourceId?: string
	nodes?: SceneNodeModel[]
}

/** Node of a scene: an item (source instance) or a folder */
export interface SceneNodeModel {
	id: string
	sceneId: string
	sceneNodeType: 'item' | 'folder'
	name?: string
	parentId?: string
	childrenIds?: string[]
	// item only
	sceneItemId?: string
	sourceId?: string
	visible?: boolean
}

/** Model returned by StreamingService.getModel */
export interface StreamingModel {
	streamingStatus: string
	recordingStatus: string
	replayBufferStatus?: string
	streamingStatusTime?: string
	recordingStatusTime?: string
	replayBufferStatusTime?: string
	dualOutputMode?: boolean
}

/** Model returned by SceneCollectionsService.collections / activeCollection */
export interface CollectionModel {
	id: string
	name: string
}

/** Model returned by TransitionsService.getModel */
export interface TransitionsModel {
	studioMode: boolean
}

/** Model returned by PerformanceService.getModel */
export interface PerformanceModel {
	CPU: number
	bandwidth: number | null
	frameRate: number
	numberDroppedFrames: number
	percentageDroppedFrames: number
}

/** Audio source model as returned by AudioService.getSources / getSourcesForCurrentScene */
export interface AudioSourceModel {
	sourceId: string
	name: string
	muted: boolean
	resourceId?: string
}

/** Source model as emitted by SourcesService.sourceUpdated */
export interface SourceModel {
	sourceId: string
	name?: string
	muted?: boolean
	audio?: boolean
}
