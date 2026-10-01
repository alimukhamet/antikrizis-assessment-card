"use strict";
var window;
(window ||= {}).ProfileExplanationRules = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // public/profile-explanations.mjs
  var profile_explanations_exports = {};
  __export(profile_explanations_exports, {
    PROFILE_EXPLANATIONS: () => PROFILE_EXPLANATIONS,
    PROFILE_EXPLANATION_MIN: () => PROFILE_EXPLANATION_MIN,
    explanationError: () => explanationError,
    explanationLength: () => explanationLength,
    explanationText: () => explanationText
  });
  var PROFILE_EXPLANATION_MIN = 30;
  var PROFILE_EXPLANATIONS = {
    debtPurposeOther: {
      label: "\u041D\u0430 \u0447\u0442\u043E \u043F\u043E\u0442\u0440\u0430\u0442\u0438\u043B\u0438 \u043A\u0440\u0435\u0434\u0438\u0442\u043D\u044B\u0435 \u0434\u0435\u043D\u044C\u0433\u0438 \u0438 \u043F\u043E\u0447\u0435\u043C\u0443 \u0432\u043E\u0437\u043D\u0438\u043A\u043B\u0438 \u0434\u043E\u043B\u0433\u0438?",
      prompt: "\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u0446\u0435\u043B\u0438: \u0447\u0442\u043E \u043E\u043F\u043B\u0430\u0442\u0438\u043B\u0438 \u0438\u043B\u0438 \u043A\u0443\u043F\u0438\u043B\u0438, \u043A\u0442\u043E \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043B\u0441\u044F \u0434\u0435\u043D\u044C\u0433\u0430\u043C\u0438 \u0438 \u043F\u043E\u0447\u0435\u043C\u0443 \u043F\u043E\u043D\u0430\u0434\u043E\u0431\u0438\u043B\u0441\u044F \u043A\u0440\u0435\u0434\u0438\u0442. \u0415\u0441\u043B\u0438 \u043F\u043E\u0433\u0430\u0448\u0430\u043B\u0438 \u043F\u0440\u0435\u0436\u043D\u0438\u0435 \u0434\u043E\u043B\u0433\u0438, \u0443\u0442\u043E\u0447\u043D\u0438\u0442\u0435 \u043A\u0430\u043A\u0438\u0435. \u041E\u0434\u0438\u043D \u043E\u0431\u0449\u0438\u0439 \u043E\u0442\u0432\u0435\u0442 \u043F\u043E \u0432\u0441\u0435\u043C \u043A\u0440\u0435\u0434\u0438\u0442\u0430\u043C."
    },
    n12008: {
      label: "\u0427\u0442\u043E \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u043E\u0441\u044C, \u043A\u043E\u0433\u0434\u0430 \u0438 \u043F\u043E\u0447\u0435\u043C\u0443 \u0441\u0442\u0430\u043B\u043E \u0442\u0440\u0443\u0434\u043D\u043E \u043F\u043B\u0430\u0442\u0438\u0442\u044C?",
      prompt: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u0435 \u0438 \u043C\u0435\u0441\u044F\u0446/\u0433\u043E\u0434, \u043A\u0430\u043A \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0438\u0441\u044C \u0434\u043E\u0445\u043E\u0434\u044B \u0438\u043B\u0438 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u044B \u0438 \u043F\u043E\u0447\u0435\u043C\u0443 \u0434\u0435\u043D\u0435\u0433 \u0441\u0442\u0430\u043B\u043E \u043D\u0435 \u0445\u0432\u0430\u0442\u0430\u0442\u044C \u043D\u0430 \u043F\u043B\u0430\u0442\u0435\u0436\u0438. \u0417\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u044B\u0435 \u0444\u0430\u043A\u0442\u044B \u0441\u043E \u0441\u043B\u043E\u0432 \u043A\u043B\u0438\u0435\u043D\u0442\u0430."
    }
  };
  function explanationText(value) {
    return String(value ?? "").replace(/\s+/gu, " ").trim();
  }
  function explanationLength(value) {
    return Array.from(explanationText(value)).length;
  }
  function explanationError(value) {
    const text = explanationText(value);
    if (/^(?:(?:не\s+знаю|неизвестно|unknown|idk|уточнить\s+позже)[\s.,;:!?—-]*)+$/iu.test(text)) {
      return `\u0423\u0442\u043E\u0447\u043D\u0438\u0442\u0435 \u0444\u0430\u043A\u0442\u044B \u0443 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u0438 \u043D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u043E\u0431\u044A\u044F\u0441\u043D\u0435\u043D\u0438\u0435 \u2014 \u043C\u0438\u043D\u0438\u043C\u0443\u043C ${PROFILE_EXPLANATION_MIN} \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432.`;
    }
    const length = explanationLength(text);
    return length < PROFILE_EXPLANATION_MIN ? `\u041C\u0438\u043D\u0438\u043C\u0443\u043C ${PROFILE_EXPLANATION_MIN} \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432, \u0441\u0435\u0439\u0447\u0430\u0441 ${length}. \u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u043E\u0431\u044A\u044F\u0441\u043D\u0435\u043D\u0438\u0435 \u0444\u0430\u043A\u0442\u0430\u043C\u0438.` : null;
  }
  return __toCommonJS(profile_explanations_exports);
})();
