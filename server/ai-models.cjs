'use strict';

const AI_MODELS = Object.freeze(['gpt-6-sol', 'gpt-6-luna']);
const DEFAULT_AI_MODEL = AI_MODELS[0];
const isSupportedAiModel = (model) => AI_MODELS.includes(model);
const normalizeAiModel = (model) => isSupportedAiModel(model) ? model : DEFAULT_AI_MODEL;

module.exports = { AI_MODELS, DEFAULT_AI_MODEL, isSupportedAiModel, normalizeAiModel };
