import type { PolicyContext, TimeWindowCriterion } from '@agentokratia/guardian-core';
import type { CriterionEvaluator } from './types.js';

export const timeWindowEvaluator: CriterionEvaluator<TimeWindowCriterion> = {
	type: 'timeWindow',
	evaluate(c, ctx) {
		const hour = ctx.currentHourUtc;
		const { startHour, endHour } = c;

		// Same hour = 24h window (always allowed)
		if (startHour === endHour) return true;

		if (startHour < endHour) {
			return hour >= startHour && hour < endHour;
		}
		// Overnight range: e.g. 22-6
		return hour >= startHour || hour < endHour;
	},
	failReason(c, ctx) {
		return {
			short: 'Outside trading hours',
			detail: `Current hour ${ctx.currentHourUtc} UTC is outside trading window ${c.startHour}:00–${c.endHour}:00`,
		};
	},
};
