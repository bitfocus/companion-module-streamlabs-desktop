import { describe, expect, it } from 'vitest'
import {
	SlobsState,
	buildSceneItemResource,
	parseSceneItemDisplayTarget,
	sanitizeVariableId,
	sceneItemLabel,
} from '../state.js'
import type { SceneNodeModel } from '../slobs/types.js'

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

describe('dual output scene items', () => {
	function item(id: string, name: string, display: 'horizontal' | 'vertical', visible: boolean): SceneNodeModel {
		return {
			id,
			sceneId: 'scene_1',
			sceneNodeType: 'item',
			sceneItemId: id,
			sourceId: `src_${name}`,
			name,
			display,
			visible,
		}
	}

	function makeState(withNodeMaps = true) {
		const state = new SlobsState()
		state.setScenes(
			[
				{
					id: 'scene_1',
					name: 'FaceCam + Chat',
					nodes: [
						item('v_cam', 'Facecam', 'vertical', true),
						item('v_chat', 'Chat', 'vertical', false),
						item('h_cam', 'Facecam', 'horizontal', false),
						item('h_chat', 'Chat', 'horizontal', true),
						item('v_only', 'Facecam 9x16', 'vertical', true),
					],
				},
			],
			withNodeMaps ? { scene_1: { h_cam: 'v_cam', h_chat: 'v_chat' } } : {},
		)
		return state
	}

	it('pairs the horizontal and vertical copies from the node maps', () => {
		const state = makeState()
		expect(state.findSceneItem('scene_1::h_cam')).toMatchObject({ display: 'horizontal', partnerKey: 'scene_1::v_cam' })
		expect(state.findSceneItem('scene_1::v_cam')).toMatchObject({ display: 'vertical', partnerKey: 'scene_1::h_cam' })
		expect(state.findSceneItem('scene_1::v_only')?.partnerKey).toBeNull()
	})

	it('lists a pair once, through its horizontal copy', () => {
		const state = makeState()
		expect(state.selectableSceneItems.map((sceneItem) => sceneItem.key)).toEqual([
			'scene_1::h_cam',
			'scene_1::h_chat',
			'scene_1::v_only',
		])
	})

	it('keeps every copy selectable when the node maps are unavailable', () => {
		const state = makeState(false)
		expect(state.selectableSceneItems).toHaveLength(5)
		expect(state.resolveSceneItems('scene_1::v_cam', 'both').map((copy) => copy.key)).toEqual(['scene_1::v_cam'])
	})

	it('resolves the copies to target, the picked one first', () => {
		const state = makeState()
		const keys = (key: string, display: 'both' | 'horizontal' | 'vertical') =>
			state.resolveSceneItems(key, display).map((copy) => copy.key)

		expect(keys('scene_1::h_cam', 'both')).toEqual(['scene_1::h_cam', 'scene_1::v_cam'])
		expect(keys('scene_1::v_cam', 'both')).toEqual(['scene_1::v_cam', 'scene_1::h_cam'])
		expect(keys('scene_1::h_cam', 'vertical')).toEqual(['scene_1::v_cam'])
		expect(keys('scene_1::v_cam', 'horizontal')).toEqual(['scene_1::h_cam'])
		// A single display item ignores the display option
		expect(keys('scene_1::v_only', 'horizontal')).toEqual(['scene_1::v_only'])
		expect(keys('scene_1::ghost', 'both')).toEqual([])
	})

	it('ignores node map entries that do not pair a horizontal and a vertical item', () => {
		const state = new SlobsState()
		state.setScenes(
			[
				{
					id: 'scene_1',
					name: 'Scene',
					nodes: [item('h_a', 'A', 'horizontal', true), item('h_b', 'B', 'horizontal', true)],
				},
			],
			{ scene_1: { h_a: 'h_b', h_b: 'missing' } },
		)
		expect(state.sceneItems.every((sceneItem) => sceneItem.partnerKey === null)).toBe(true)
	})

	it('builds the API resource of a copy', () => {
		const state = makeState()
		const copy = state.findSceneItem('scene_1::v_cam')
		expect(copy && buildSceneItemResource(copy)).toBe('SceneItem["scene_1","v_cam","src_Facecam"]')
	})

	it('defaults unknown display options to the horizontal display', () => {
		expect(parseSceneItemDisplayTarget('vertical')).toBe('vertical')
		expect(parseSceneItemDisplayTarget('both')).toBe('both')
		expect(parseSceneItemDisplayTarget(undefined)).toBe('horizontal')
		expect(parseSceneItemDisplayTarget('other')).toBe('horizontal')
	})

	it('labels single display vertical items', () => {
		const state = makeState()
		expect(state.selectableSceneItems.map(sceneItemLabel)).toEqual([
			'FaceCam + Chat: Facecam',
			'FaceCam + Chat: Chat',
			'FaceCam + Chat: Facecam 9x16 (vertical)',
		])
	})
})

describe('scene item labels', () => {
	function folder(id: string, name: string, parentId?: string): SceneNodeModel {
		return { id, sceneId: 'scene_1', sceneNodeType: 'folder', name, parentId }
	}

	function camera(id: string, parentId?: string): SceneNodeModel {
		return {
			id,
			sceneId: 'scene_1',
			sceneNodeType: 'item',
			sceneItemId: id,
			sourceId: 'src_cam',
			name: 'Facecam',
			parentId,
		}
	}

	it('tells apart items sharing a name with their folder path', () => {
		const state = new SlobsState()
		state.setScenes([
			{
				id: 'scene_1',
				name: 'Ecran + Cam',
				nodes: [
					folder('f_16x9', '16x9'),
					folder('f_cam_16x9', 'Camera', 'f_16x9'),
					camera('cam_16x9', 'f_cam_16x9'),
					folder('f_9x16', '9x16'),
					camera('cam_9x16', 'f_9x16'),
					camera('cam_root'),
				],
			},
		])
		expect(state.sceneItems.map(sceneItemLabel)).toEqual([
			'Ecran + Cam: 16x9 / Camera / Facecam',
			'Ecran + Cam: 9x16 / Facecam',
			'Ecran + Cam: Facecam',
		])
	})

	it('survives a cyclic folder tree', () => {
		const state = new SlobsState()
		state.setScenes([
			{
				id: 'scene_1',
				name: 'Scene',
				nodes: [folder('f_a', 'A', 'f_b'), folder('f_b', 'B', 'f_a'), camera('cam', 'f_a')],
			},
		])
		expect(state.sceneItems[0]?.folders).toEqual(['B', 'A'])
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

	it('deduplicates colliding variable ids with a stable sourceId suffix', () => {
		const state = new SlobsState()
		state.setAudioSources([
			{ sourceId: 'a', name: 'Mic/Aux', muted: false },
			{ sourceId: 'b', name: 'Mic Aux', muted: true },
		])
		expect(state.audioSources.map((source) => source.variableId)).toEqual(['mute_Mic_Aux_a', 'mute_Mic_Aux_b'])
	})

	it('assigns colliding ids independently of the list order, and the plain id when unique', () => {
		const state = new SlobsState()
		state.setAudioSources([
			{ sourceId: 'b', name: 'Mic Aux', muted: true },
			{ sourceId: 'a', name: 'Mic/Aux', muted: false },
		])
		expect(state.audioSources.map((source) => source.variableId)).toEqual(['mute_Mic_Aux_b', 'mute_Mic_Aux_a'])

		state.setAudioSources([{ sourceId: 'b', name: 'Mic Aux', muted: true }])
		expect(state.audioSources[0]?.variableId).toBe('mute_Mic_Aux')
	})

	it('applies mute changes only to known sources', () => {
		const state = new SlobsState()
		state.setAudioSources([{ sourceId: 'a', name: 'Mic', muted: false }])
		expect(state.applySourceMuted('a', true)?.muted).toBe(true)
		expect(state.applySourceMuted('a', true)).toBeUndefined() // unchanged
		expect(state.applySourceMuted('unknown', true)).toBeUndefined()
	})
})
