import { describe, expect, it } from 'vitest'
import type { CompanionMigrationAction, CompanionMigrationFeedback } from '@companion-module/base'
import { UpgradeScripts } from '../upgrades.js'

describe('v1.1.0 upgrade: dual output display option', () => {
	const upgrade = UpgradeScripts[0]

	function run(actions: CompanionMigrationAction[], feedbacks: CompanionMigrationFeedback[]) {
		return upgrade({ currentConfig: {} as never }, { config: null, secrets: null, actions, feedbacks })
	}

	it('targets the horizontal copy on existing visibility actions and feedbacks', () => {
		const result = run(
			[
				{
					id: 'a1',
					controlId: 'c',
					actionId: 'item_visibility',
					options: { item: { value: 'k', isExpression: false } },
				},
				{ id: 'a2', controlId: 'c', actionId: 'streaming_toggle', options: {} },
			],
			[{ id: 'f1', controlId: 'c', feedbackId: 'item_visible', options: {} }],
		)
		expect(result.updatedActions.map((action) => [action.id, action.options.display])).toEqual([
			['a1', { value: 'horizontal', isExpression: false }],
		])
		expect(result.updatedFeedbacks.map((feedback) => [feedback.id, feedback.options.display])).toEqual([
			['f1', { value: 'horizontal', isExpression: false }],
		])
	})

	it('leaves an already set display untouched', () => {
		const display = { value: 'vertical', isExpression: false as const }
		const result = run(
			[{ id: 'a1', controlId: 'c', actionId: 'item_visibility', options: { display } }],
			[{ id: 'f1', controlId: 'c', feedbackId: 'item_visible', options: { display } }],
		)
		expect(result.updatedActions).toHaveLength(0)
		expect(result.updatedFeedbacks).toHaveLength(0)
	})
})
