// Mutable singleton for state shared across modules and used widely throughout
// main.js. Fields are added in batches as they're factored out of main.js.
// Each field's initial value is assigned in main.js (where the previous
// `let X = INIT` lived) so the load-at-startup order is preserved.
export const state = {};
