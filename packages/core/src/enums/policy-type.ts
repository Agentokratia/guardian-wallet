export enum PolicyType {
	SPENDING_LIMIT = 'spending_limit',
	DAILY_LIMIT = 'daily_limit',
	MONTHLY_LIMIT = 'monthly_limit',
	ALLOWED_CONTRACTS = 'allowed_contracts',
	ALLOWED_FUNCTIONS = 'allowed_functions',
	BLOCKED_ADDRESSES = 'blocked_addresses',
	RATE_LIMIT = 'rate_limit',
	TIME_WINDOW = 'time_window',
	RULE_REJECT = 'rule_reject',
	DEFAULT_DENY = 'default_deny',
}
