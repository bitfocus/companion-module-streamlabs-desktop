import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig } from './config.js'

/** v1.1.0: dual output display option on scene item visibility. Existing actions and feedbacks target the
 * horizontal copy: the main output, even when they were set up on its identically named vertical copy */
const addSceneItemDisplayOption: CompanionStaticUpgradeScript<ModuleConfig> = (_context, props) => {
	const updatedActions = props.actions.filter(
		(action) => action.actionId === 'item_visibility' && action.options.display === undefined,
	)
	for (const action of updatedActions) action.options.display = { value: 'horizontal', isExpression: false }

	const updatedFeedbacks = props.feedbacks.filter(
		(feedback) => feedback.feedbackId === 'item_visible' && feedback.options.display === undefined,
	)
	for (const feedback of updatedFeedbacks) feedback.options.display = { value: 'horizontal', isExpression: false }

	return { updatedConfig: null, updatedActions, updatedFeedbacks }
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [
	/*
	 * Place your upgrade scripts here
	 * Remember that once it has been added it cannot be removed!
	 */
	addSceneItemDisplayOption,
]
