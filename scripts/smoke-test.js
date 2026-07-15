#!/usr/bin/env node
/**
 * Manual smoke test for the SlobsConnection transport layer (milestone M1).
 *
 * Usage:
 *   yarn build
 *   SLOBS_TOKEN=<token> node scripts/smoke-test.js
 *
 * Optional env vars: SLOBS_HOST (default 127.0.0.1), SLOBS_PORT (default 59650),
 * SLOBS_WAIT (seconds to listen for sceneSwitched events, default 8).
 *
 * The token is read from the environment and never printed.
 */

import { SlobsConnection } from '../dist/slobs/connection.js'

const host = process.env.SLOBS_HOST ?? '127.0.0.1'
const port = Number(process.env.SLOBS_PORT ?? 59650)
const token = process.env.SLOBS_TOKEN
const waitSeconds = Number(process.env.SLOBS_WAIT ?? 8)

if (!token) {
	console.error('SLOBS_TOKEN env var is required (Streamlabs Desktop > Settings > Remote Control > Show details)')
	process.exit(2)
}

const connection = new SlobsConnection({ host, port, token, reconnect: false })

connection.on('log', (level, message) => console.log(`[${level}] ${message}`))
connection.on('authFailed', (message) => {
	console.error(`AUTH FAILED: ${message}`)
	process.exit(3)
})
connection.on('disconnected', (reason) => {
	console.log(`Disconnected: ${reason}`)
})

const result = await new Promise((resolve, reject) => {
	const timeout = setTimeout(() => reject(new Error('Timed out waiting for connection')), 15000)

	connection.on('connected', () => {
		clearTimeout(timeout)
		resolve(runChecks())
	})
	connection.start()
})

console.log(result)

async function runChecks() {
	const scenes = await connection.request('ScenesService', 'getScenes')
	const activeSceneId = await connection.request('ScenesService', 'activeSceneId')

	console.log(`\nScenes (${scenes.length}):`)
	for (const scene of scenes) {
		const marker = scene.id === activeSceneId ? ' <- active' : ''
		console.log(`  - ${scene.name} (${scene.id})${marker}`)
	}

	await connection.subscribe('ScenesService', 'sceneSwitched', (scene) => {
		console.log(`EVENT sceneSwitched -> "${scene.name}" (${scene.id})`)
	})

	console.log(`\nListening for sceneSwitched events for ${waitSeconds}s (switch scenes in Streamlabs to test)...`)
	await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))

	connection.destroy()
	return 'Smoke test finished: connection, auth, getScenes, activeSceneId and event subscription all OK'
}
