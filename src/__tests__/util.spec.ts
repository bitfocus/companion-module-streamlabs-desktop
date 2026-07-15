import { describe, expect, it } from 'vitest'
import { extractStatus, formatDuration } from '../util.js'

describe('formatDuration', () => {
	it('formats durations as HH:MM:SS', () => {
		expect(formatDuration(0)).toBe('00:00:00')
		expect(formatDuration(59_999)).toBe('00:00:59')
		expect(formatDuration(60_000)).toBe('00:01:00')
		expect(formatDuration(3_600_000)).toBe('01:00:00')
		expect(formatDuration(3_600_000 * 12 + 34 * 60_000 + 56_000)).toBe('12:34:56')
	})

	it('clamps negative durations to zero', () => {
		expect(formatDuration(-5000)).toBe('00:00:00')
	})

	it('supports durations above 24 hours', () => {
		expect(formatDuration(25 * 3_600_000)).toBe('25:00:00')
	})
})

describe('extractStatus', () => {
	it('accepts raw status strings (live event payloads)', () => {
		expect(extractStatus('recording', 'recordingStatus')).toBe('recording')
		expect(extractStatus('writing', 'recordingStatus')).toBe('writing')
	})

	it('accepts partial models keyed by the status field', () => {
		expect(extractStatus({ streamingStatus: 'live' }, 'streamingStatus')).toBe('live')
	})

	it('returns null for unusable payloads', () => {
		expect(extractStatus(null, 'streamingStatus')).toBeNull()
		expect(extractStatus(42, 'streamingStatus')).toBeNull()
		expect(extractStatus({ other: 'x' }, 'streamingStatus')).toBeNull()
	})
})
