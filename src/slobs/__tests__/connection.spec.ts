import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlobsConnection, type SockJsSocket } from '../connection.js'

const TOKEN = 'super-secret-token-abcdef'

class FakeSocket implements SockJsSocket {
	onopen: (() => void) | null = null
	onmessage: ((ev: { data: string }) => void) | null = null
	onclose: ((ev: { code?: number; reason?: string }) => void) | null = null

	readonly sent: Array<Record<string, unknown>> = []
	closed = false

	send(data: string): void {
		this.sent.push(JSON.parse(data) as Record<string, unknown>)
	}

	close(): void {
		this.closed = true
	}

	// Test helpers
	open(): void {
		this.onopen?.()
	}

	receive(message: unknown): void {
		this.onmessage?.({ data: JSON.stringify(message) })
	}

	dropConnection(reason = 'transport closed'): void {
		this.onclose?.({ code: 1006, reason })
	}

	lastRequest(): Record<string, unknown> {
		const message = this.sent.at(-1)
		if (!message) throw new Error('nothing was sent')
		return message
	}

	respondTo(request: Record<string, unknown>, result: unknown): void {
		this.receive({ jsonrpc: '2.0', id: request.id, result })
	}
}

interface Harness {
	connection: SlobsConnection
	sockets: FakeSocket[]
	logs: string[]
	socket(): FakeSocket
}

function createHarness(options: { reconnect?: boolean } = {}): Harness {
	const sockets: FakeSocket[] = []
	const logs: string[] = []
	const connection = new SlobsConnection({
		host: '127.0.0.1',
		port: 59650,
		token: TOKEN,
		reconnect: options.reconnect ?? true,
		socketFactory: () => {
			const socket = new FakeSocket()
			sockets.push(socket)
			return socket
		},
	})
	connection.on('log', (level, message) => logs.push(`${level}: ${message}`))
	return { connection, sockets, logs, socket: () => sockets.at(-1) as FakeSocket }
}

/** Open the transport and complete the auth handshake */
function completeAuth(harness: Harness): void {
	harness.socket().open()
	const auth = harness.socket().lastRequest()
	expect(auth.method).toBe('auth')
	harness.socket().respondTo(auth, true)
}

/** Let promise chains settle without advancing timers */
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('auth handshake', () => {
	it('sends auth as the first message and emits connected on success', async () => {
		const harness = createHarness()
		const connected = vi.fn()
		harness.connection.on('connected', connected)

		harness.connection.start()
		expect(harness.sockets).toHaveLength(1)

		harness.socket().open()
		const auth = harness.socket().lastRequest()
		expect(auth).toMatchObject({
			jsonrpc: '2.0',
			method: 'auth',
			params: { resource: 'TcpServerService', args: [TOKEN] },
		})

		harness.socket().respondTo(auth, true)
		await vi.waitFor(() => expect(connected).toHaveBeenCalledOnce())
		expect(harness.connection.isConnected).toBe(true)
	})

	it('emits authFailed when Streamlabs rejects the token', async () => {
		const harness = createHarness()
		const authFailed = vi.fn()
		harness.connection.on('authFailed', authFailed)

		harness.connection.start()
		harness.socket().open()
		const auth = harness.socket().lastRequest()
		harness.socket().receive({
			jsonrpc: '2.0',
			id: auth.id,
			error: { code: -32603, message: 'INTERNAL_JSON_RPC_ERROR Invalid token' },
		})

		await vi.waitFor(() => expect(authFailed).toHaveBeenCalledOnce())
		expect(harness.connection.isConnected).toBe(false)
	})

	it('never includes the token in log messages', async () => {
		const harness = createHarness()
		const connected = vi.fn()
		harness.connection.on('connected', connected)

		harness.connection.start()
		completeAuth(harness)
		await vi.waitFor(() => expect(connected).toHaveBeenCalledOnce())

		expect(harness.logs.length).toBeGreaterThan(0)
		for (const line of harness.logs) {
			expect(line).not.toContain(TOKEN)
		}
	})
})

describe('JSON-RPC correlation', () => {
	it('resolves requests from responses with a matching id', async () => {
		const harness = createHarness()
		harness.connection.start()
		completeAuth(harness)

		const promise = harness.connection.request('ScenesService', 'getScenes')
		const request = harness.socket().lastRequest()
		expect(request).toMatchObject({ method: 'getScenes', params: { resource: 'ScenesService', args: [] } })

		harness.socket().respondTo(request, [{ id: 'scene_1', name: 'Scene 1' }])
		await expect(promise).resolves.toEqual([{ id: 'scene_1', name: 'Scene 1' }])
	})

	it('rejects requests when the response carries an error', async () => {
		const harness = createHarness()
		harness.connection.start()
		completeAuth(harness)

		const promise = harness.connection.request('ScenesService', 'nope')
		const request = harness.socket().lastRequest()
		harness.socket().receive({
			jsonrpc: '2.0',
			id: request.id,
			error: { code: -32601, message: 'Method not found' },
		})

		await expect(promise).rejects.toThrow(/Method not found/)
	})

	it('rejects requests that time out', async () => {
		const harness = createHarness()
		harness.connection.start()
		completeAuth(harness)

		const promise = harness.connection.request('ScenesService', 'getScenes')
		const assertion = expect(promise).rejects.toThrow(/timed out/)
		vi.advanceTimersByTime(10001)
		await assertion
	})

	it('resolves async API methods through the PROMISE event flow', async () => {
		const harness = createHarness()
		harness.connection.start()
		completeAuth(harness)

		const promise = harness.connection.request('SceneCollectionsService', 'load')
		const request = harness.socket().lastRequest()

		// Immediate response promises a deferred result
		harness.socket().respondTo(request, {
			_type: 'SUBSCRIPTION',
			resourceId: 'promise-42',
			emitter: 'PROMISE',
		})
		// Later event carries the actual result
		harness.socket().receive({
			jsonrpc: '2.0',
			id: null,
			result: { _type: 'EVENT', resourceId: 'promise-42', emitter: 'PROMISE', data: { done: true } },
		})

		await expect(promise).resolves.toEqual({ done: true })
	})
})

describe('event subscriptions', () => {
	it('dispatches STREAM events to the subscribed handler', async () => {
		const harness = createHarness()
		harness.connection.start()
		completeAuth(harness)

		const handler = vi.fn()
		const subscribed = harness.connection.subscribe('ScenesService', 'sceneSwitched', handler)
		// The subscription is armed asynchronously once the auth response has settled
		await vi.waitFor(() => expect(harness.socket().lastRequest().method).toBe('sceneSwitched'))
		const request = harness.socket().lastRequest()
		expect(request).toMatchObject({ method: 'sceneSwitched', params: { resource: 'ScenesService' } })
		harness.socket().respondTo(request, {
			_type: 'SUBSCRIPTION',
			resourceId: 'ScenesService.sceneSwitched',
			emitter: 'STREAM',
		})
		await subscribed
		await flushMicrotasks() // let the subscription activation settle

		harness.socket().receive({
			jsonrpc: '2.0',
			id: null,
			result: {
				_type: 'EVENT',
				resourceId: 'ScenesService.sceneSwitched',
				emitter: 'STREAM',
				data: { id: 'scene_2', name: 'Scene 2' },
			},
		})

		expect(handler).toHaveBeenCalledWith({ id: 'scene_2', name: 'Scene 2' })
	})
})

describe('reconnection', () => {
	it('reconnects with backoff and re-subscribes after a drop', async () => {
		const harness = createHarness()
		const connected = vi.fn()
		harness.connection.on('connected', connected)

		harness.connection.start()
		completeAuth(harness)
		await vi.waitFor(() => expect(connected).toHaveBeenCalledOnce())

		const handler = vi.fn()
		const subscribed = harness.connection.subscribe('ScenesService', 'sceneSwitched', handler)
		harness.socket().respondTo(harness.socket().lastRequest(), {
			_type: 'SUBSCRIPTION',
			resourceId: 'ScenesService.sceneSwitched',
			emitter: 'STREAM',
		})
		await subscribed

		const disconnected = vi.fn()
		harness.connection.on('disconnected', disconnected)
		harness.socket().dropConnection()
		expect(disconnected).toHaveBeenCalledOnce()
		expect(harness.connection.isConnected).toBe(false)

		// Backoff: a second transport must be created after the delay
		await vi.advanceTimersByTimeAsync(3000)
		expect(harness.sockets).toHaveLength(2)

		// Auth again, then the subscription must be re-armed before 'connected'
		harness.socket().open()
		const auth = harness.socket().lastRequest()
		expect(auth.method).toBe('auth')
		harness.socket().respondTo(auth, true)

		await vi.waitFor(() => {
			const resubscribe = harness.socket().lastRequest()
			expect(resubscribe.method).toBe('sceneSwitched')
		})
		harness.socket().respondTo(harness.socket().lastRequest(), {
			_type: 'SUBSCRIPTION',
			resourceId: 'ScenesService.sceneSwitched',
			emitter: 'STREAM',
		})

		await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(2))

		// Events keep flowing after the reconnect
		harness.socket().receive({
			jsonrpc: '2.0',
			id: null,
			result: {
				_type: 'EVENT',
				resourceId: 'ScenesService.sceneSwitched',
				emitter: 'STREAM',
				data: { id: 'scene_3', name: 'Scene 3' },
			},
		})
		expect(handler).toHaveBeenCalledWith({ id: 'scene_3', name: 'Scene 3' })
	})

	it('rejects pending requests when the connection drops', async () => {
		const harness = createHarness()
		harness.connection.start()
		completeAuth(harness)

		const promise = harness.connection.request('ScenesService', 'getScenes')
		const assertion = expect(promise).rejects.toThrow(/Connection closed/)
		harness.socket().dropConnection()
		await assertion
	})

	it('does not reconnect after destroy', async () => {
		const harness = createHarness()
		harness.connection.start()
		completeAuth(harness)

		harness.connection.destroy()
		expect(harness.socket().closed).toBe(true)

		await vi.advanceTimersByTimeAsync(60000)
		expect(harness.sockets).toHaveLength(1)
	})

	it('keeps retrying with growing delays while the endpoint stays down', async () => {
		const harness = createHarness()
		harness.connection.start()

		// First attempt fails straight away
		harness.socket().dropConnection('refused')
		expect(harness.sockets).toHaveLength(1)

		// First retry after ~2s (failedAttempts=1 -> min 2000ms + jitter)
		await vi.advanceTimersByTimeAsync(2300)
		expect(harness.sockets).toHaveLength(2)

		harness.socket().dropConnection('refused')
		// Second retry after ~4s
		await vi.advanceTimersByTimeAsync(1000)
		expect(harness.sockets).toHaveLength(2)
		await vi.advanceTimersByTimeAsync(3500)
		expect(harness.sockets).toHaveLength(3)
	})
})
