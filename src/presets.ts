import { combineRgb, type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'

const COLOR_WHITE = combineRgb(255, 255, 255)
const COLOR_BLACK = combineRgb(0, 0, 0)
const COLOR_RED = combineRgb(204, 0, 0)
const COLOR_GREEN = combineRgb(0, 153, 0)
const COLOR_ORANGE = combineRgb(255, 102, 0)

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}

	// --- Scenes ---------------------------------------------------------------
	const scenePresetIds: string[] = []
	for (const scene of self.state.scenes) {
		const presetId = `scene_${scene.id}`
		scenePresetIds.push(presetId)
		presets[presetId] = {
			type: 'simple',
			name: `Switch to scene "${scene.name}"`,
			style: {
				text: scene.name,
				size: 'auto',
				color: COLOR_WHITE,
				bgcolor: COLOR_BLACK,
				show_topbar: false,
			},
			steps: [
				{
					down: [
						{
							actionId: 'set_scene',
							options: { scene: scene.id },
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'scene_active',
					options: { scene: scene.id },
					style: {
						bgcolor: COLOR_RED,
						color: COLOR_WHITE,
					},
				},
			],
		}
	}

	// --- Streaming / recording / replay ----------------------------------------
	presets['streaming_toggle'] = {
		type: 'simple',
		name: 'Toggle streaming, red while the stream is active, with live timer',
		style: {
			text: `STREAM\n$(${self.label}:stream_duration)`,
			size: 'auto',
			color: COLOR_WHITE,
			bgcolor: COLOR_BLACK,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'streaming_toggle',
						options: {},
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'streaming_active',
				options: {},
				style: {
					bgcolor: COLOR_RED,
					color: COLOR_WHITE,
				},
			},
		],
	}

	presets['recording_toggle'] = {
		type: 'simple',
		name: 'Toggle recording, red while the recording is active, with timer',
		style: {
			text: `REC\n$(${self.label}:recording_duration)`,
			size: 'auto',
			color: COLOR_WHITE,
			bgcolor: COLOR_BLACK,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'recording_toggle',
						options: {},
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'recording_active',
				options: {},
				style: {
					bgcolor: COLOR_RED,
					color: COLOR_WHITE,
				},
			},
		],
	}

	presets['replay_toggle'] = {
		type: 'simple',
		name: 'Toggle the replay buffer, green while running',
		style: {
			text: 'REPLAY\nBUFFER',
			size: 'auto',
			color: COLOR_WHITE,
			bgcolor: COLOR_BLACK,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'replay_toggle',
						options: {},
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'replay_buffer_active',
				options: {},
				style: {
					bgcolor: COLOR_GREEN,
					color: COLOR_WHITE,
				},
			},
		],
	}

	presets['replay_save'] = {
		type: 'simple',
		name: 'Save the replay buffer to disk',
		style: {
			text: 'SAVE\nREPLAY',
			size: 'auto',
			color: COLOR_WHITE,
			bgcolor: COLOR_BLACK,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'replay_save',
						options: {},
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'replay_buffer_active',
				options: {},
				style: {
					bgcolor: COLOR_GREEN,
					color: COLOR_WHITE,
				},
			},
		],
	}

	// --- Audio ------------------------------------------------------------------
	const audioPresetIds: string[] = []
	for (const source of self.state.audioSources) {
		const presetId = `audio_${source.sourceId}`
		audioPresetIds.push(presetId)
		presets[presetId] = {
			type: 'simple',
			name: `Toggle mute of "${source.name}", red while muted`,
			style: {
				text: source.name,
				size: 'auto',
				color: COLOR_WHITE,
				bgcolor: COLOR_BLACK,
				show_topbar: false,
			},
			steps: [
				{
					down: [
						{
							actionId: 'audio_mute',
							options: { source: source.sourceId, mode: 'toggle' },
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'audio_muted',
					options: { source: source.sourceId },
					style: {
						bgcolor: COLOR_RED,
						color: COLOR_WHITE,
					},
				},
			],
		}
	}

	// --- Studio mode --------------------------------------------------------------
	presets['studio_mode_toggle'] = {
		type: 'simple',
		name: 'Toggle studio mode, orange while enabled',
		style: {
			text: 'STUDIO\nMODE',
			size: 'auto',
			color: COLOR_WHITE,
			bgcolor: COLOR_BLACK,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'studio_mode_toggle',
						options: {},
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'studio_mode_active',
				options: {},
				style: {
					bgcolor: COLOR_ORANGE,
					color: COLOR_WHITE,
				},
			},
		],
	}

	presets['studio_transition'] = {
		type: 'simple',
		name: 'Execute the studio mode transition',
		style: {
			text: 'TAKE',
			size: 'auto',
			color: COLOR_WHITE,
			bgcolor: COLOR_BLACK,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'studio_transition',
						options: {},
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'studio_mode_active',
				options: {},
				style: {
					bgcolor: COLOR_ORANGE,
					color: COLOR_WHITE,
				},
			},
		],
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'scenes',
			name: 'Scenes',
			definitions: [
				{
					id: 'scene_buttons',
					name: 'Scenes',
					description: 'One button per scene, red when the scene is active',
					type: 'simple',
					presets: scenePresetIds,
				},
			],
		},
		{
			id: 'streaming',
			name: 'Streaming and recording',
			definitions: [
				{
					id: 'stream_record',
					name: 'Streaming and recording',
					description: 'Toggle buttons with live state feedback and timers',
					type: 'simple',
					presets: ['streaming_toggle', 'recording_toggle', 'replay_toggle', 'replay_save'],
				},
			],
		},
		{
			id: 'audio',
			name: 'Audio',
			definitions: [
				{
					id: 'audio_mutes',
					name: 'Audio sources',
					description: 'One mute toggle per audio source, red while muted',
					type: 'simple',
					presets: audioPresetIds,
				},
			],
		},
		{
			id: 'studio',
			name: 'Studio mode',
			definitions: [
				{
					id: 'studio_buttons',
					name: 'Studio mode',
					description: 'Studio mode toggle and transition (not available with dual output enabled)',
					type: 'simple',
					presets: ['studio_mode_toggle', 'studio_transition'],
				},
			],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
