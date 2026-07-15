import { describe, expect, it } from 'vitest'
import { SlobsState, sanitizeVariableId } from '../state.js'

describe('scene name resolution', () => {
	const state = new SlobsState()
	state.setScenes([
		{ id: 'scene_1', name: 'FaceCam + Chat' },
		{ id: 'scene_2', name: 'BOUCLE - Debut Live' },
	])

	it('resolves an exact name to its scene', () => {
		expect(state.findSceneByName('FaceCam + Chat')?.id).toBe('scene_1')
	})

	it('returns undefined for unknown names', () => {
		expect(state.findSceneByName('facecam + chat')).toBeUndefined()
		expect(state.findSceneByName('')).toBeUndefined()
	})

	it('matches case-insensitively when requested', () => {
		expect(state.findSceneByName('facecam + chat', true)?.id).toBe('scene_1')
		expect(state.findSceneByName('FACECAM + CHAT', true)?.id).toBe('scene_1')
		expect(state.findSceneByName('inconnue', true)).toBeUndefined()
	})

	it('exposes the active scene from its id', () => {
		state.setActiveScene('scene_2')
		expect(state.activeScene?.name).toBe('BOUCLE - Debut Live')
		state.setActiveScene('gone')
		expect(state.activeScene).toBeUndefined()
	})
})

describe('scene items', () => {
	function makeState() {
		const state = new SlobsState()
		state.setScenes([
			{
				id: 'scene_1',
				name: 'Scene A',
				nodes: [
					{ id: 'f1', sceneId: 'scene_1', sceneNodeType: 'folder', name: 'Folder', childrenIds: ['n1'] },
					{
						id: 'n1',
						sceneId: 'scene_1',
						sceneNodeType: 'item',
						sceneItemId: 'item_1',
						sourceId: 'src_1',
						name: 'Camera',
						visible: true,
					},
					{
						id: 'n2',
						sceneId: 'scene_1',
						sceneNodeType: 'item',
						sceneItemId: 'item_2',
						sourceId: 'src_2',
						name: 'Overlay',
						visible: false,
					},
				],
			},
			{ id: 'scene_2', name: 'Scene B', nodes: [] },
		])
		return state
	}

	it('flattens items and skips folders', () => {
		const state = makeState()
		expect(state.sceneItems).toHaveLength(2)
		expect(state.sceneItems[0]).toMatchObject({
			key: 'scene_1::item_1',
			sceneName: 'Scene A',
			name: 'Camera',
			sourceId: 'src_1',
			visible: true,
		})
	})

	it('finds items by key and applies visibility changes', () => {
		const state = makeState()
		expect(state.findSceneItem('scene_1::item_2')?.visible).toBe(false)
		expect(state.applyItemVisibility('scene_1', 'item_2', true)?.visible).toBe(true)
		expect(state.applyItemVisibility('scene_1', 'item_2', true)).toBeUndefined() // unchanged
		expect(state.applyItemVisibility('scene_1', 'ghost', true)).toBeUndefined()
	})
})

describe('collections, replay buffer and studio mode', () => {
	it('tracks the active collection', () => {
		const state = new SlobsState()
		state.setCollections(
			[
				{ id: 'c1', name: 'Prod' },
				{ id: 'c2', name: 'Backup' },
			],
			'c1',
		)
		expect(state.activeCollection?.name).toBe('Prod')
		state.activeCollectionId = 'c2'
		expect(state.activeCollection?.name).toBe('Backup')
	})

	it('treats every non-offline replay buffer status as active', () => {
		const state = new SlobsState()
		expect(state.replayBufferActive).toBe(false)
		for (const status of ['running', 'stopping', 'saving']) {
			state.replayBufferStatus = status
			expect(state.replayBufferActive).toBe(true)
		}
	})

	it('clear() resets the new fields too', () => {
		const state = new SlobsState()
		state.setCollections([{ id: 'c1', name: 'Prod' }], 'c1')
		state.studioMode = true
		state.replayBufferStatus = 'running'
		state.performance = { cpu: 12, fps: 60, droppedFrames: 3, droppedFramesPercent: 0.5 }
		state.clear()
		expect(state.collections).toHaveLength(0)
		expect(state.activeCollectionId).toBeNull()
		expect(state.studioMode).toBe(false)
		expect(state.replayBufferStatus).toBe('offline')
		expect(state.performance.cpu).toBe(0)
	})
})

describe('streaming state helpers', () => {
	it('treats every non-offline status as active', () => {
		const state = new SlobsState()
		expect(state.streamingActive).toBe(false)
		for (const status of ['starting', 'live', 'ending', 'reconnecting']) {
			state.streamingStatus = status
			expect(state.streamingActive).toBe(true)
		}
		state.recordingStatus = 'recording'
		expect(state.recordingActive).toBe(true)
	})
})

describe('audio source variables', () => {
	it('sanitizes names into valid variable ids', () => {
		expect(sanitizeVariableId('Mic/Aux')).toBe('Mic_Aux')
		expect(sanitizeVariableId('Audio du bureau')).toBe('Audio_du_bureau')
		expect(sanitizeVariableId('  --  ')).toBe('source')
	})

	it('deduplicates colliding variable ids', () => {
		const state = new SlobsState()
		state.setAudioSources([
			{ sourceId: 'a', name: 'Mic/Aux', muted: false },
			{ sourceId: 'b', name: 'Mic Aux', muted: true },
		])
		const ids = state.audioSources.map((source) => source.variableId)
		expect(ids[0]).toBe('mute_Mic_Aux')
		expect(ids[1]).toBe('mute_Mic_Aux_')
		expect(new Set(ids).size).toBe(2)
	})

	it('applies mute changes only to known sources', () => {
		const state = new SlobsState()
		state.setAudioSources([{ sourceId: 'a', name: 'Mic', muted: false }])
		expect(state.applySourceMuted('a', true)?.muted).toBe(true)
		expect(state.applySourceMuted('a', true)).toBeUndefined() // unchanged
		expect(state.applySourceMuted('unknown', true)).toBeUndefined()
	})
})
