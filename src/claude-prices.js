// What the Claude API costs us, in USD per million tokens — the one place to
// change when Anthropic changes its prices. Checked 2026-10-20 against
// Anthropic's price list of 2026-10-06 (platform.claude.com → Pricing).
// Prompt-cache writes (5 minutes) cost 1.25× input, cache reads 0.1× input.
// Haiku 5.5 costs more above 100K-token prompts; ours stay far below that.
export const CLAUDE_PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};
const CACHE_WRITE = 1.25, CACHE_READ = 0.1;

// One answer's cost in millionths of a dollar, from the API's usage block.
export function tokenCostMicro(price, usage = {}) {
  const n = k => usage[k] || 0;
  return Math.round(price.input * (n('input_tokens') + CACHE_WRITE * n('cache_creation_input_tokens') + CACHE_READ * n('cache_read_input_tokens'))
    + price.output * n('output_tokens'));
}
