// Live validation of the protocol paths against a running Streamlabs Desktop.
// WARNING: briefly switches scenes, toggles one mute, toggles one scene item
// visibility, runs the replay buffer and records for a few seconds.
// Refuses to run when a stream or recording is active. toggleStreaming is NEVER called.
// Everything is restored to its original state.
// Usage: yarn build && SLOBS_TOKEN=<token> node scripts/live-validation.js
import { SlobsConnection } from '../dist/slobs/connection.js'

const token = process.env.SLOBS_TOKEN
if (!token) {
	console.error('SLOBS_TOKEN required')
	process.exit(2)
}

const results = []
function report(name, ok, detail = '') {
	results.push({ name, ok })
	console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` (${detail})` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const connection = new SlobsConnection({ host: '127.0.0.1', port: 59650, token, reconnect: false })
connection.on('log', () => {})

await new Promise((resolve, reject) => {
	const t = setTimeout(() => reject(new Error('connect timeout')), 15000)
	connection.on('connected', () => {
		clearTimeout(t)
		resolve()
	})
	connection.on('authFailed', (m) => reject(new Error(m)))
	connection.start()
})

// ---- Safety gate: nothing live, nothing recording -------------------------
const model = await connection.request('StreamingService', 'getModel')
console.log(
	`Etat initial: streaming=${model.streamingStatus}, recording=${model.recordingStatus}, replayBuffer=${model.replayBufferStatus}`,
)
if (model.streamingStatus !== 'offline' || model.recordingStatus !== 'offline') {
	console.log('Stream ou record actif: aucun test intrusif ne sera lance.')
	connection.destroy()
	process.exit(0)
}

// ---- Scenes ------------------------------------------------------------
const sceneEvents = []
await connection.subscribe('ScenesService', 'sceneSwitched', (scene) => sceneEvents.push(scene))

const scenes = await connection.request('ScenesService', 'getScenes')
const originalSceneId = await connection.request('ScenesService', 'activeSceneId')
const otherScene = scenes.find((s) => s.id !== originalSceneId)
const originalScene = scenes.find((s) => s.id === originalSceneId)

report('getScenes', Array.isArray(scenes) && scenes.length > 0, `${scenes.length} scenes`)

if (otherScene) {
	await connection.request('ScenesService', 'makeSceneActive', otherScene.id)
	await sleep(600)
	let activeNow = await connection.request('ScenesService', 'activeSceneId')
	report('makeSceneActive by id', activeNow === otherScene.id)

	const byName = scenes.find((s) => s.name === originalScene.name)
	await connection.request('ScenesService', 'makeSceneActive', byName.id)
	await sleep(600)
	activeNow = await connection.request('ScenesService', 'activeSceneId')
	report('name->id resolution + activate', activeNow === originalSceneId)
	report('sceneSwitched events', sceneEvents.length >= 2, `${sceneEvents.length} events`)
}

// ---- Scene item visibility ---------------------------------------------------
const itemEvents = []
await connection.subscribe('ScenesService', 'itemUpdated', (d) => itemEvents.push(d))
const sceneWithItem = scenes.find((s) => s.id !== originalSceneId && (s.nodes ?? []).some((n) => n.sceneNodeType === 'item'))
if (sceneWithItem) {
	const node = sceneWithItem.nodes.find((n) => n.sceneNodeType === 'item')
	const resource = `SceneItem["${sceneWithItem.id}","${node.sceneItemId}","${node.sourceId}"]`
	const before = node.visible
	await connection.request(resource, 'setVisibility', !before)
	await sleep(400)
	const mid = (await connection.request('ScenesService', 'getScene', sceneWithItem.id)).nodes.find(
		(n) => n.sceneItemId === node.sceneItemId,
	)
	await connection.request(resource, 'setVisibility', before)
	await sleep(400)
	const after = (await connection.request('ScenesService', 'getScene', sceneWithItem.id)).nodes.find(
		(n) => n.sceneItemId === node.sceneItemId,
	)
	report('SceneItem.setVisibility round-trip', mid.visible === !before && after.visible === before, `"${node.name}"`)
	report('itemUpdated events', itemEvents.length >= 2, `${itemEvents.length} events`)
} else {
	report('SceneItem.setVisibility round-trip', false, 'aucune scene non-active avec items')
}

// ---- Collections / transitions / performance (lecture seule) ---------------
const collections = await connection.request('SceneCollectionsService', 'collections')
const activeCollection = await connection.request('SceneCollectionsService', 'activeCollection')
report(
	'SceneCollectionsService reads',
	Array.isArray(collections) && collections.length > 0 && typeof activeCollection?.id === 'string',
	`${collections.length} collection(s), active "${activeCollection?.name}"`,
)

const transitions = await connection.request('TransitionsService', 'getModel')
report('TransitionsService.getModel', typeof transitions?.studioMode === 'boolean', `studioMode=${transitions.studioMode}`)

const perf = await connection.request('PerformanceService', 'getModel')
report(
	'PerformanceService.getModel',
	typeof perf?.CPU === 'number' && typeof perf?.frameRate === 'number',
	`CPU=${perf.CPU?.toFixed?.(1)}%, fps=${Math.round(perf.frameRate)}, dropped=${perf.numberDroppedFrames}`,
)

// ---- Audio -------------------------------------------------------------
const audioSources = await connection.request('AudioService', 'getSources')
const shapeOk =
	Array.isArray(audioSources) &&
	audioSources.every((s) => typeof s.sourceId === 'string' && typeof s.name === 'string' && 'muted' in s)
report('AudioService.getSources shape', shapeOk, `${audioSources.length} sources`)

const target = audioSources.find((s) => typeof s.muted === 'boolean')
if (target) {
	const sourceUpdates = []
	await connection.subscribe('SourcesService', 'sourceUpdated', (source) => sourceUpdates.push(source))
	const initialMuted = target.muted

	let audioSourcePathOk = false
	try {
		await connection.request(`AudioSource["${target.sourceId}"]`, 'setMuted', !initialMuted)
		await sleep(500)
		const after = await connection.request('AudioService', 'getSource', target.sourceId)
		audioSourcePathOk = after.muted === !initialMuted
	} catch (error) {
		console.log(`  AudioSource["id"].setMuted a echoue: ${error.message}`)
	}
	report('AudioSource["id"].setMuted', audioSourcePathOk, `sur "${target.name}"`)

	let sourcesServicePathOk = false
	try {
		await connection.request('SourcesService', 'setMuted', target.sourceId, initialMuted) // restores initial state
		await sleep(500)
		const after = await connection.request('AudioService', 'getSource', target.sourceId)
		sourcesServicePathOk = after.muted === initialMuted
	} catch (error) {
		console.log(`  SourcesService.setMuted a echoue: ${error.message}`)
		await connection.request(`AudioSource["${target.sourceId}"]`, 'setMuted', initialMuted)
	}
	report('SourcesService.setMuted (fallback)', sourcesServicePathOk)

	const finalState = await connection.request('AudioService', 'getSource', target.sourceId)
	report('etat mute restaure', finalState.muted === initialMuted)
	report('sourceUpdated events', sourceUpdates.filter((s) => s.sourceId === target.sourceId).length >= 1)
}

// ---- Replay buffer (bref aller-retour) ---------------------------------------
const rbEvents = []
await connection.subscribe('StreamingService', 'replayBufferStatusChange', (d) => rbEvents.push(d))
try {
	await connection.request('StreamingService', 'startReplayBuffer')
	let status = null
	for (let i = 0; i < 15; i++) {
		await sleep(400)
		status = (await connection.request('StreamingService', 'getModel')).replayBufferStatus
		if (status && status !== 'offline') break
	}
	report('replay buffer demarre', status === 'running', `status=${status}`)
	await connection.request('StreamingService', 'stopReplayBuffer')
	for (let i = 0; i < 20; i++) {
		await sleep(400)
		status = (await connection.request('StreamingService', 'getModel')).replayBufferStatus
		if (status === 'offline') break
	}
	report('replay buffer arrete', status === 'offline')
	report('replayBufferStatusChange events', rbEvents.length >= 1, `${rbEvents.length} events: ${JSON.stringify(rbEvents)}`)
} catch (error) {
	report('replay buffer', false, error.message)
}

// ---- Recording (bref aller-retour, PAS de streaming) -------------------
const recordingEvents = []
await connection.subscribe('StreamingService', 'recordingStatusChange', (data) => recordingEvents.push(data))

await connection.request('StreamingService', 'toggleRecording')
let recStarted = false
for (let i = 0; i < 20; i++) {
	await sleep(300)
	const m = await connection.request('StreamingService', 'getModel')
	if (m.recordingStatus === 'recording') {
		recStarted = true
		break
	}
}
report('toggleRecording demarre', recStarted)

await connection.request('StreamingService', 'toggleRecording')
let recStopped = false
for (let i = 0; i < 30; i++) {
	await sleep(300)
	const m = await connection.request('StreamingService', 'getModel')
	if (m.recordingStatus === 'offline') {
		recStopped = true
		break
	}
}
report('toggleRecording arrete', recStopped)
report('recordingStatusChange events', recordingEvents.length >= 1, `${recordingEvents.length} events`)

connection.destroy()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} verifications OK`)
process.exit(failed.length > 0 ? 1 : 0)
