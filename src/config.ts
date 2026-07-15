import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	audioScope: string
	lockStreaming: boolean
	enablePerformance: boolean
}

export type ModuleSecrets = {
	token: string
}

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 59650

/** Defaults applied when a field is missing (config created by an older version) */
export const CONFIG_DEFAULTS: Omit<ModuleConfig, 'host' | 'port'> = {
	audioScope: 'all',
	lockStreaming: false,
	enablePerformance: true,
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Information',
			width: 12,
			value:
				'This module controls Streamlabs Desktop through its remote control API. ' +
				'In Streamlabs Desktop, open Settings > Remote Control, click the QR code, then "Show details" to reveal the API token and port.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Host',
			tooltip: 'IP or hostname of the machine running Streamlabs Desktop',
			width: 8,
			default: DEFAULT_HOST,
			regex: Regex.HOSTNAME,
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			tooltip: 'Remote control port (Settings > Remote Control > Show details)',
			width: 4,
			min: 1,
			max: 65535,
			default: DEFAULT_PORT,
		},
		{
			type: 'secret-text',
			id: 'token',
			label: 'API token',
			tooltip: 'Settings > Remote Control > click the QR code > Show details > API token',
			width: 12,
		},
		{
			type: 'dropdown',
			id: 'audioScope',
			label: 'Audio sources list',
			tooltip:
				'"All audio sources" targets any source of the collection. "Current scene only" keeps the lists short but limits actions and variables to the sources of the active scene.',
			width: 6,
			choices: [
				{ id: 'all', label: 'All audio sources' },
				{ id: 'current_scene', label: 'Current scene only' },
			],
			default: 'all',
		},
		{
			type: 'checkbox',
			id: 'enablePerformance',
			label: 'Performance stats',
			tooltip: 'Poll CPU, FPS and dropped frames every 2 seconds and expose them as variables',
			width: 6,
			default: true,
		},
		{
			type: 'checkbox',
			id: 'lockStreaming',
			label: 'Safety lock: disable streaming actions',
			tooltip: 'When enabled, the Streaming start/stop/toggle actions do nothing. Handy during rehearsals.',
			width: 12,
			default: false,
		},
	]
}
