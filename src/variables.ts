import type { CompanionVariableDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type VariablesSchema = {
	current_scene: string
	current_scene_id: string
	current_collection: string
	streaming: boolean
	streaming_status: string
	stream_duration: string
	recording: boolean
	recording_status: string
	recording_duration: string
	replay_buffer: boolean
	replay_buffer_status: string
	studio_mode: boolean
	cpu_usage: number
	fps: number
	dropped_frames: number
	dropped_frames_percent: number
} & {
	// One mute_<source name> variable per audio source, defined dynamically
	[variableId: string]: string | number | boolean | undefined
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		current_scene: { name: 'Name of the active scene' },
		current_scene_id: { name: 'Id of the active scene' },
		current_collection: { name: 'Name of the active scene collection' },
		streaming: { name: 'Streaming is active (true/false)' },
		streaming_status: { name: 'Raw streaming status (offline, starting, live, ending, reconnecting)' },
		stream_duration: { name: 'Time since the stream went live (HH:MM:SS)' },
		recording: { name: 'Recording is active (true/false)' },
		recording_status: { name: 'Raw recording status (offline, starting, recording, stopping, writing)' },
		recording_duration: { name: 'Time since the recording started (HH:MM:SS)' },
		replay_buffer: { name: 'Replay buffer is running (true/false)' },
		replay_buffer_status: { name: 'Raw replay buffer status (offline, running, stopping, saving)' },
		studio_mode: { name: 'Studio mode is enabled (true/false)' },
		cpu_usage: { name: 'CPU usage of Streamlabs Desktop (%)' },
		fps: { name: 'Current output frame rate' },
		dropped_frames: { name: 'Number of dropped frames' },
		dropped_frames_percent: { name: 'Percentage of dropped frames' },
	}

	for (const source of self.state.audioSources) {
		definitions[source.variableId] = { name: `Mute state of "${source.name}" (true/false)` }
	}

	self.setVariableDefinitions(definitions)
}
