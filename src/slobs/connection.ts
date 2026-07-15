import { EventEmitter } from 'node:events'
import SockJS from 'sockjs-client'
import {
	isEventResult,
	isSubscriptionResult,
	type JsonRpcRequest,
	type JsonRpcResponse,
	type SubscriptionResult,
} from './types.js'

/**
 * Minimal structural type for the socket returned by the sockjs-client factory,
 * so we do not depend on a specific DOM/undici WebSocket lib definition.
 */
export interface SockJsSocket {
	onopen: (() => void) | null
	onmessage: ((ev: { data: string }) => void) | null
	onclose: ((ev: { code?: number; reason?: string }) => void) | null
	send(data: string): void
	close(code?: number, reason?: string): void
}

export interface SlobsConnectionOptions {
	host: string
	port: number
	token: string
	/** Timeout for a single JSON-RPC request (ms), default 10000 */
	requestTimeoutMs?: number
	/** Automatically reconnect with exponential backoff, default true */
	reconnect?: boolean
	/** Transport factory, replaceable for unit tests. Defaults to sockjs-client */
	socketFactory?: (url: string) => SockJsSocket
}

export type SlobsLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface SlobsConnectionEvents {
	/** Emitted when a (re)connection attempt starts. attempt is 1-based */
	connecting: [attempt: number]
	/** Emitted after successful auth and re-subscription of all registered channels */
	connected: []
	/** Emitted when the transport closes. failedAttempts counts consecutive failures since the last successful auth */
	disconnected: [reason: string, failedAttempts: number]
	/** Emitted when Streamlabs rejects the auth token */
	authFailed: [message: string]
	/** Log messages, decoupled from any host framework */
	log: [level: SlobsLogLevel, message: string]
}

interface PendingRequest {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
	timeout: NodeJS.Timeout
	description: string
}

type SubscriptionHandler = (data: unknown) => void

interface Subscription {
	resource: string
	channel: string
	handler: SubscriptionHandler
	/** resourceId as returned by the SUBSCRIPTION response, when currently active */
	activeResourceId: string | null
}

const RECONNECT_MIN_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30000

/**
 * Transport layer for the Streamlabs Desktop remote control API:
 * SockJS + JSON-RPC 2.0 + token auth + event subscriptions + auto-reconnect.
 *
 * This class is independent from the Companion framework so it can be tested standalone.
 * The auth token is never included in any log message.
 */
export class SlobsConnection extends EventEmitter<SlobsConnectionEvents> {
	readonly #options: Required<SlobsConnectionOptions>

	#socket: SockJsSocket | null = null
	#destroyed = false
	#authenticated = false
	#nextRequestId = 1
	#failedAttempts = 0
	#reconnectTimer: NodeJS.Timeout | null = null

	readonly #pendingRequests = new Map<number, PendingRequest>()
	/** Requests resolved later through an EVENT with emitter PROMISE, keyed by resourceId */
	readonly #pendingPromises = new Map<string, PendingRequest>()
	/** Registered event subscriptions, keyed by `${resource}.${channel}` */
	readonly #subscriptions = new Map<string, Subscription>()

	constructor(options: SlobsConnectionOptions) {
		super()
		this.#options = {
			requestTimeoutMs: 10000,
			reconnect: true,
			// The sockjs-client typings return a DOM-flavoured WebSocket; narrow to what we use
			socketFactory: (url) => new SockJS(url) as unknown as SockJsSocket,
			...options,
		}
	}

	get url(): string {
		return `http://${this.#options.host}:${this.#options.port}/api`
	}

	get isConnected(): boolean {
		return this.#authenticated
	}

	/** Open the connection. Safe to call once; reconnections are handled internally. */
	start(): void {
		if (this.#destroyed) throw new Error('Connection has been destroyed')
		this.#connect()
	}

	/** Close the connection and stop any reconnection. The instance cannot be reused. */
	destroy(): void {
		this.#destroyed = true
		this.#clearReconnectTimer()
		this.#teardownSocket('destroyed')
	}

	/**
	 * Send a JSON-RPC request and await its result.
	 * Async API methods (emitter PROMISE) are resolved transparently.
	 */
	async request<T = unknown>(resource: string, method: string, ...args: unknown[]): Promise<T> {
		if (this.#destroyed) throw new Error('Connection has been destroyed')
		if (!this.#socket) throw new Error('Not connected to Streamlabs Desktop')

		return this.#sendRequest<T>(resource, method, args)
	}

	/**
	 * Subscribe to an event channel (e.g. ScenesService.sceneSwitched).
	 * The subscription survives reconnections: it is re-established after every successful auth.
	 */
	async subscribe(resource: string, channel: string, handler: SubscriptionHandler): Promise<void> {
		const key = `${resource}.${channel}`
		const subscription: Subscription = { resource, channel, handler, activeResourceId: null }
		this.#subscriptions.set(key, subscription)

		if (this.#authenticated) {
			await this.#activateSubscription(subscription)
		}
	}

	/** Remove a subscription and notify Streamlabs when currently connected. */
	async unsubscribe(resource: string, channel: string): Promise<void> {
		const key = `${resource}.${channel}`
		const subscription = this.#subscriptions.get(key)
		if (!subscription) return

		this.#subscriptions.delete(key)
		if (subscription.activeResourceId && this.#authenticated) {
			await this.#sendRequest(subscription.activeResourceId, 'unsubscribe', [])
		}
	}

	#connect(): void {
		if (this.#destroyed || this.#socket) return

		const attempt = this.#failedAttempts + 1
		this.emit('connecting', attempt)
		this.#log('debug', `Connecting to ${this.url} (attempt ${attempt})`)

		const socket = this.#options.socketFactory(this.url)
		this.#socket = socket

		socket.onopen = () => {
			if (this.#socket !== socket) return
			this.#authenticate()
		}

		socket.onmessage = (ev) => {
			if (this.#socket !== socket) return
			this.#handleMessage(ev.data)
		}

		socket.onclose = (ev) => {
			if (this.#socket !== socket) return
			this.#handleClose(ev.reason || `code ${ev.code ?? 'unknown'}`)
		}
	}

	#authenticate(): void {
		this.#log('debug', 'Transport open, authenticating')
		this.#sendRequest<boolean>('TcpServerService', 'auth', [this.#options.token])
			.then(async (authenticated) => {
				if (!authenticated) {
					// Streamlabs returns false instead of an error in some versions
					this.#handleAuthFailure('Authentication rejected')
					return
				}

				await this.#resubscribeAll()

				this.#authenticated = true
				this.#failedAttempts = 0
				this.#log('info', 'Authenticated with Streamlabs Desktop')
				this.emit('connected')
			})
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error)
				if (/token/i.test(message)) {
					this.#handleAuthFailure(message)
				} else {
					this.#log('warn', `Authentication request failed: ${message}`)
					this.#teardownSocket(`auth request failed: ${message}`)
				}
			})
	}

	#handleAuthFailure(message: string): void {
		this.#log('error', `Streamlabs Desktop rejected the API token (${message})`)
		this.emit('authFailed', message)
		// Keep reconnecting (with backoff): the user may fix the token in Streamlabs at any time
		this.#failedAttempts += 1
		this.#teardownSocket('authentication failed')
	}

	async #resubscribeAll(): Promise<void> {
		for (const subscription of this.#subscriptions.values()) {
			await this.#activateSubscription(subscription)
		}
	}

	async #activateSubscription(subscription: Subscription): Promise<void> {
		const result = await this.#sendRequest<SubscriptionResult>(subscription.resource, subscription.channel, [])
		if (!isSubscriptionResult(result)) {
			throw new Error(`Unexpected subscription response for ${subscription.resource}.${subscription.channel}`)
		}
		subscription.activeResourceId = result.resourceId
		this.#log('debug', `Subscribed to ${result.resourceId}`)
	}

	async #sendRequest<T>(resource: string, method: string, args: unknown[]): Promise<T> {
		const socket = this.#socket
		if (!socket) throw new Error('Not connected to Streamlabs Desktop')

		const id = this.#nextRequestId++
		const description = `${resource}.${method}`
		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			id,
			method,
			params: { resource, args },
		}

		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.#pendingRequests.delete(id)
				reject(new Error(`Request ${description} timed out after ${this.#options.requestTimeoutMs}ms`))
			}, this.#options.requestTimeoutMs)

			this.#pendingRequests.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timeout,
				description,
			})

			this.#log('debug', `-> ${description} (id ${id})`)
			try {
				socket.send(JSON.stringify(request))
			} catch (error) {
				clearTimeout(timeout)
				this.#pendingRequests.delete(id)
				reject(error instanceof Error ? error : new Error(String(error)))
			}
		})
	}

	#handleMessage(raw: string): void {
		let message: JsonRpcResponse
		try {
			message = JSON.parse(raw) as JsonRpcResponse
		} catch {
			this.#log('warn', 'Received a message that is not valid JSON, ignoring it')
			return
		}

		// Correlate responses with pending requests
		if (typeof message.id === 'number') {
			const pending = this.#pendingRequests.get(message.id)
			if (pending) {
				this.#pendingRequests.delete(message.id)
				clearTimeout(pending.timeout)

				if (message.error) {
					pending.reject(
						new Error(`${pending.description} failed: ${message.error.message} (code ${message.error.code})`),
					)
					return
				}

				// Async API methods answer with a PROMISE subscription that resolves through a later EVENT
				if (isSubscriptionResult(message.result) && message.result.emitter === 'PROMISE') {
					this.#pendingPromises.set(message.result.resourceId, pending)
					return
				}

				pending.resolve(message.result)
				return
			}
		}

		// Dispatch events (subscriptions and async method completions)
		if (isEventResult(message.result)) {
			const event = message.result

			if (event.emitter === 'PROMISE') {
				const pending = this.#pendingPromises.get(event.resourceId)
				if (pending) {
					this.#pendingPromises.delete(event.resourceId)
					if (event.isRejected) {
						pending.reject(new Error(`${pending.description} was rejected`))
					} else {
						pending.resolve(event.data)
					}
				}
				return
			}

			for (const subscription of this.#subscriptions.values()) {
				if (subscription.activeResourceId === event.resourceId) {
					try {
						subscription.handler(event.data)
					} catch (error) {
						this.#log('error', `Subscription handler for ${event.resourceId} threw: ${String(error)}`)
					}
					return
				}
			}

			this.#log('debug', `Ignoring event for unknown subscription ${event.resourceId}`)
			return
		}

		this.#log('debug', 'Ignoring unexpected message from Streamlabs Desktop')
	}

	#handleClose(reason: string): void {
		const wasAuthenticated = this.#authenticated
		this.#failedAttempts += 1

		if (wasAuthenticated) {
			this.#log('warn', `Connection to Streamlabs Desktop lost (${reason})`)
		}

		this.#teardownSocket(reason)
	}

	#teardownSocket(reason: string): void {
		const socket = this.#socket
		this.#socket = null

		if (socket) {
			socket.onopen = null
			socket.onmessage = null
			socket.onclose = null
			try {
				socket.close()
			} catch {
				// The socket may already be closed
			}
		}

		this.#rejectAllPending(reason)

		for (const subscription of this.#subscriptions.values()) {
			subscription.activeResourceId = null
		}

		if (this.#authenticated || socket) {
			this.#authenticated = false
			this.emit('disconnected', reason, this.#failedAttempts)
		}

		// A close initiated by us (destroy/auth failure) still needs to trigger a reconnect decision
		if (!this.#destroyed && !this.#reconnectTimer && this.#options.reconnect && reason !== 'destroyed') {
			this.#scheduleReconnect()
		}
	}

	#rejectAllPending(reason: string): void {
		for (const pending of this.#pendingRequests.values()) {
			clearTimeout(pending.timeout)
			pending.reject(new Error(`Connection closed (${reason}) during ${pending.description}`))
		}
		this.#pendingRequests.clear()

		for (const pending of this.#pendingPromises.values()) {
			clearTimeout(pending.timeout)
			pending.reject(new Error(`Connection closed (${reason}) during ${pending.description}`))
		}
		this.#pendingPromises.clear()
	}

	#scheduleReconnect(): void {
		if (this.#destroyed || !this.#options.reconnect || this.#reconnectTimer) return

		const exponent = Math.min(this.#failedAttempts, 5)
		const delay = Math.min(RECONNECT_MIN_DELAY_MS * 2 ** exponent, RECONNECT_MAX_DELAY_MS) + Math.random() * 250
		this.#log('debug', `Reconnecting in ${Math.round(delay)}ms`)

		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null
			this.#connect()
		}, delay)
	}

	#clearReconnectTimer(): void {
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer)
			this.#reconnectTimer = null
		}
	}

	#log(level: SlobsLogLevel, message: string): void {
		this.emit('log', level, message)
	}
}
