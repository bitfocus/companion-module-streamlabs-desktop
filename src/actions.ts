import type { DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type ActionsSchema = {
	set_scene: {
		options: {
			scene: string
		}
	}
	set_scene_by_name: {
		options: {
			name: string
			ignore_case: boolean
		}
	}
	set_collection: {
		options: {
			collection: string
		}
	}
	streaming_toggle: { options: Record<string, never> }
	streaming_start: { options: Record<string, never> }
	streaming_stop: { options: Record<string, never> }
	recording_toggle: { options: Record<string, never> }
	recording_start: { options: Record<string, never> }
	recording_stop: { options: Record<string, never> }
	replay_toggle: { options: Record<string, never> }
	replay_start: { options: Record<string, never> }
	replay_stop: { options: Record<string, never> }
	replay_save: { options: Record<string, never> }
	audio_mute: {
		options: {
			source: string
			mode: string
		}
	}
	item_visibility: {
		options: {
			item: string
			mode: string
		}
	}
	studio_mode_toggle: { options: Record<string, never> }
	studio_mode_enable: { options: Record<string, never> }
	studio_mode_disable: { options: Record<string, never> }
	studio_transition: { options: Record<string, never> }
}

export function sceneChoices(self: ModuleInstance): DropdownChoice[] {
	return self.state.scenes.map((scene) => ({ id: scene.id, label: scene.name }))
}

export function audioSourceChoices(self: ModuleInstance): DropdownChoice[] {
	return self.state.audioSources.map((source) => ({ id: source.sourceId, label: source.name }))
}

export function sceneItemChoices(self: ModuleInstance): DropdownChoice[] {
	return self.state.sceneItems.map((item) => ({ id: item.key, label: `${item.sceneName}: ${item.name}` }))
}

export function collectionChoices(self: ModuleInstance): DropdownChoice[] {
	return self.state.collections.map((collection) => ({ id: collection.id, label: collection.name }))
}

const VISIBILITY_MODES: DropdownChoice[] = [
	{ id: 'show', label: 'Show' },
	{ id: 'hide', label: 'Hide' },
	{ id: 'toggle', label: 'Toggle' },
]

export function UpdateActions(self: ModuleInstance): void {
	const scenes = sceneChoices(self)
	const audioSources = audioSourceChoices(self)
	const sceneItems = sceneItemChoices(self)
	const collections = collectionChoices(self)

	self.setActionDefinitions({
		set_scene: {
			name: 'Scene: Set active scene',
			options: [
				{
					id: 'scene',
					type: 'dropdown',
					label: 'Scene',
					choices: scenes,
					default: scenes[0]?.id ?? '',
					allowCustom: true,
					tooltip: 'Pick a scene, or provide a scene id',
				},
			],
			callback: async (event) => {
				await self.setSceneActive(event.options.scene)
			},
		},
		set_scene_by_name: {
			name: 'Scene: Set active scene by name',
			description: 'Activates the scene matching this name. Supports variables.',
			options: [
				{
					id: 'name',
					type: 'textinput',
					label: 'Scene name',
					default: '',
					useVariables: true,
				},
				{
					id: 'ignore_case',
					type: 'checkbox',
					label: 'Ignore case',
					default: false,
				},
			],
			callback: async (event) => {
				const name = event.options.name.trim()
				if (!name) {
					self.log('warn', 'Set scene by name: no scene name provided')
					return
				}
				await self.setSceneActiveByName(name, event.options.ignore_case)
			},
		},
		set_collection: {
			name: 'Scene collection: Switch',
			description: 'Loads another scene collection. Streamlabs reloads all scenes and sources.',
			options: [
				{
					id: 'collection',
					type: 'dropdown',
					label: 'Scene collection',
					choices: collections,
					default: collections[0]?.id ?? '',
				},
			],
			callback: async (event) => {
				await self.setCollectionActive(event.options.collection)
			},
		},
		streaming_toggle: {
			name: 'Streaming: Toggle',
			options: [],
			callback: async () => {
				await self.setStreamingActive('toggle')
			},
		},
		streaming_start: {
			name: 'Streaming: Start',
			options: [],
			callback: async () => {
				await self.setStreamingActive(true)
			},
		},
		streaming_stop: {
			name: 'Streaming: Stop',
			options: [],
			callback: async () => {
				await self.setStreamingActive(false)
			},
		},
		recording_toggle: {
			name: 'Recording: Toggle',
			options: [],
			callback: async () => {
				await self.setRecordingActive('toggle')
			},
		},
		recording_start: {
			name: 'Recording: Start',
			options: [],
			callback: async () => {
				await self.setRecordingActive(true)
			},
		},
		recording_stop: {
			name: 'Recording: Stop',
			options: [],
			callback: async () => {
				await self.setRecordingActive(false)
			},
		},
		replay_toggle: {
			name: 'Replay buffer: Toggle',
			options: [],
			callback: async () => {
				await self.setReplayBufferActive('toggle')
			},
		},
		replay_start: {
			name: 'Replay buffer: Start',
			options: [],
			callback: async () => {
				await self.setReplayBufferActive(true)
			},
		},
		replay_stop: {
			name: 'Replay buffer: Stop',
			options: [],
			callback: async () => {
				await self.setReplayBufferActive(false)
			},
		},
		replay_save: {
			name: 'Replay buffer: Save replay',
			description: 'Saves the replay buffer to disk. The buffer must be running.',
			options: [],
			callback: async () => {
				await self.saveReplay()
			},
		},
		audio_mute: {
			name: 'Audio: Mute / unmute source',
			options: [
				{
					id: 'source',
					type: 'dropdown',
					label: 'Audio source',
					choices: audioSources,
					default: audioSources[0]?.id ?? '',
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					choices: [
						{ id: 'mute', label: 'Mute' },
						{ id: 'unmute', label: 'Unmute' },
						{ id: 'toggle', label: 'Toggle' },
					],
					default: 'toggle',
				},
			],
			callback: async (event) => {
				const desired = event.options.mode === 'toggle' ? 'toggle' : event.options.mode === 'mute'
				await self.setSourceMuted(event.options.source, desired)
			},
		},
		item_visibility: {
			name: 'Source: Show / hide scene item',
			options: [
				{
					id: 'item',
					type: 'dropdown',
					label: 'Scene item',
					choices: sceneItems,
					default: sceneItems[0]?.id ?? '',
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					choices: VISIBILITY_MODES,
					default: 'toggle',
				},
			],
			callback: async (event) => {
				const desired = event.options.mode === 'toggle' ? 'toggle' : event.options.mode === 'show'
				await self.setSceneItemVisible(event.options.item, desired)
			},
		},
		studio_mode_toggle: {
			name: 'Studio mode: Toggle',
			options: [],
			callback: async () => {
				await self.setStudioMode('toggle')
			},
		},
		studio_mode_enable: {
			name: 'Studio mode: Enable',
			options: [],
			callback: async () => {
				await self.setStudioMode(true)
			},
		},
		studio_mode_disable: {
			name: 'Studio mode: Disable',
			options: [],
			callback: async () => {
				await self.setStudioMode(false)
			},
		},
		studio_transition: {
			name: 'Studio mode: Execute transition',
			description: 'Transitions the studio mode preview to the program output',
			options: [],
			callback: async () => {
				await self.executeStudioTransition()
			},
		},
	})
}
