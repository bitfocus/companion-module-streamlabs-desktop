import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

export default [
	...baseConfig,
	{
		// Manual test harness, not part of the published module
		ignores: ['scripts/**'],
	},
	{
		// Unit tests import dev-only tooling
		files: ['**/__tests__/**', '**/*.spec.ts'],
		rules: {
			'n/no-unpublished-import': 'off',
		},
	},
]
