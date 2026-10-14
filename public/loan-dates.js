"use strict";
var window;
(window ||= {}).LoanDates = (() => {
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

  // public/loan-dates.mjs
  var loan_dates_exports = {};
  __export(loan_dates_exports, {
    formatLoanDate: () => formatLoanDate,
    loanAutofillFacts: () => loanAutofillFacts,
    loanDatePrecision: () => loanDatePrecision
  });
  function loanDatePrecision(value) {
    const text = String(value || "");
    if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(text)) return "month";
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(text)) return null;
    const date = /* @__PURE__ */ new Date(text + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? "day" : null;
  }
  function formatLoanDate(value) {
    const text = String(value || ""), precision = loanDatePrecision(text);
    return precision === "day" ? text.split("-").reverse().join(".") : precision === "month" ? text.slice(5) + "." + text.slice(0, 4) + " (\u0434\u0435\u043D\u044C \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D)" : text;
  }
  function loanAutofillFacts(credit) {
    const start = credit.contractStartDate, issuance = credit.disbursementDate;
    const issuanceOnly = Boolean(issuance) || credit.facts.some((f) => f.key === "startedAtMonth" && /Несиенің\s+нақты\s+берілген\s+күні/u.test(f.source));
    return [...credit.facts.filter((f) => f.key !== "startedAtMonth" || !start && !issuanceOnly), ...start ? [start] : [], ...issuance ? [issuance] : []];
  }
  return __toCommonJS(loan_dates_exports);
})();
