import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { audioSourceChoices, collectionChoices, sceneChoices, sceneItemChoices } from './actions.js'

export type FeedbacksSchema = {
	scene_active: {
		type: 'boolean'
		options: {
			scene: string
		}
	}
	streaming_active: {
		type: 'boolean'
		options: Record<string, never>
	}
	recording_active: {
		type: 'boolean'
		options: Record<string, never>
	}
	replay_buffer_active: {
		type: 'boolean'
		options: Record<string, never>
	}
	audio_muted: {
		type: 'boolean'
		options: {
			source: string
		}
	}
	item_visible: {
		type: 'boolean'
		options: {
			item: string
		}
	}
	collection_active: {
		type: 'boolean'
		options: {
			collection: string
		}
	}
	studio_mode_active: {
		type: 'boolean'
		options: Record<string, never>
	}
	dropped_frames_above: {
		type: 'boolean'
		options: {
			threshold: number
		}
	}
}

const COLOR_RED = combineRgb(204, 0, 0)
const COLOR_GREEN = combineRgb(0, 153, 0)
const COLOR_ORANGE = combineRgb(255, 102, 0)
const COLOR_WHITE = combineRgb(255, 255, 255)

export function UpdateFeedbacks(self: ModuleInstance): void {
	const scenes = sceneChoices(self)
	const audioSources = audioSourceChoices(self)
	const sceneItems = sceneItemChoices(self)
	const collections = collectionChoices(self)

	self.setFeedbackDefinitions({
		scene_active: {
			name: 'Scene is active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: COLOR_RED,
				color: COLOR_WHITE,
			},
			options: [
				{
					id: 'scene',
					type: 'dropdown',
					label: 'Scene',
					choices: scenes,
					default: scenes[0]?.id ?? '',
				},
			],
			callback: (feedback) => {
				return self.state.activeSceneId === feedback.options.scene
			},
		},
		streaming_active: {
			name: 'Streaming is active',
			description: 'True while the stream is starting, live, ending or reconnecting',
			type: 'boolean',
			defaultStyle: {
				bgcolor: COLOR_RED,
				color: COLOR_WHITE,
			},
			options: [],
			callback: () => {
				return self.state.streamingActive
			},
		},
		recording_active: {
			name: 'Recording is active',
			description: 'True while the recording is starting, running, stopping or writing',
			type: 'boolean',
			defaultStyle: {
				bgcolor: COLOR_RED,
				color: COLOR_WHITE,
			},
			options: [],
			callback: () => {
				return self.state.recordingActive
			},
		},
		replay_buffer_active: {
			name: 'Replay buffer is running',
			type: 'boolean',
			defaultStyle: {
				bgcolor: COLOR_GREEN,
				color: COLOR_WHITE,
			},
			options: [],
			callback: () => {
				return self.state.replayBufferActive
			},
		},
		audio_muted: {
			name: 'Audio source is muted',
			type: 'boolean',
			defaultStyle: {
				bgcolor: COLOR_RED,
				color: COLOR_WHITE,
			},
			options: [
				{
					id: 'source',
					type: 'dropdown',
					label: 'Audio source',
					choices: audioSources,
					default: audioSources[0]?.id ?? '',
				},
			],
			callback: (feedback) => {
				return self.state.findAudioSource(feedback.options.source)?.muted === true
			},
		},
		item_visible: {
			name: 'Scene item is visible',
			type: 'boolean',
			defaultStyle: {
				bgcolor: COLOR_GREEN,
				color: COLOR_WHITE,
			},
			options: [
				{
					id: 'item',
					type: 'dropdown',
					label: 'Scene item',
					choices: sceneItems,
					default: sceneItems[0]?.id ?? '',
				},
			],
			callback: (feedback) => {
				return self.state.findSceneItem(feedback.options.item)?.visible === true
			},
		},
		collection_active: {
			name: 'Scene collection is active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: COLOR_RED,
				color: COLOR_WHITE,
			},
			options: [
				{
					id: 'collection',
					type: 'dropdown',
					label: 'Scene collection',
					choices: collections,
					default: collections[0]?.id ?? '',
				},
			],
			callback: (feedback) => {
				return self.state.activeCollectionId === feedback.options.collection
			},
		},
		studio_mode_active: {
			name: 'Studio mode is enabled',
			type: 'boolean',
			defaultStyle: {
				bgcolor: COLOR_ORANGE,
				color: COLOR_WHITE,
			},
			options: [],
			callback: () => {
				return self.state.studioMode
			},
		},
		dropped_frames_above: {
			name: 'Dropped frames above threshold',
			description: 'True when the percentage of dropped frames reaches the threshold (requires performance stats)',
			type: 'boolean',
			defaultStyle: {
				bgcolor: COLOR_ORANGE,
				color: COLOR_WHITE,
			},
			options: [
				{
					id: 'threshold',
					type: 'number',
					label: 'Threshold (%)',
					default: 1,
					min: 0,
					max: 100,
				},
			],
			callback: (feedback) => {
				return self.state.performance.droppedFramesPercent >= feedback.options.threshold
			},
		},
	})
}
