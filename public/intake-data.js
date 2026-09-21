"use strict";
var window;
(window ||= {}).IntakeData = (() => {
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

  // public/intake-data.mjs
  var intake_data_exports = {};
  __export(intake_data_exports, {
    enforcementSummary: () => enforcementSummary,
    normalizeIntake: () => normalizeIntake
  });
  function normalizeIntake(payload) {
    const answers = payload.answers.map((answer) => ({ ...answer }));
    const get = (key) => answers.find((answer) => answer.key === key);
    const put = (key, value, checked = false) => {
      const old = get(key);
      if (old) Object.assign(old, { value, checked });
      else answers.push({ key, value, checked });
    };
    for (const owner of ["client", "partner"]) {
      const prefix = `holding:${owner}:`;
      if (get(prefix + "businessNone")) continue;
      const selected = answers.filter((a) => a.key.startsWith(prefix) && a.checked).map((a) => a.key.slice(prefix.length));
      const answered = selected.length > 0 && !selected.includes("unknown");
      const property = selected.some((k) => ["real", "car", "other"].includes(k));
      const business = selected.some((k) => ["ip", "too", "kh"].includes(k));
      if (answered && !property && !selected.includes("none")) put(prefix + "none", "none", true);
      put(prefix + "businessNone", "businessNone", answered && !business);
    }
    if (!get("enforcementStatus")) {
      const old = get("enforcementDetails")?.value.trim() || "";
      const unknown = get("unknown:enforcementDetails")?.checked;
      put("enforcementStatus", unknown ? "" : /^нет[.!]?$/iu.test(old) ? "no" : old ? "legacy" : "");
    }
    return { ...payload, answers };
  }
  function enforcementSummary(payload) {
    const p = normalizeIntake(payload), value = (key) => p.answers.find((a) => a.key === key)?.value.trim() || "";
    const status = value("enforcementStatus"), notes = value("enforcementDetails");
    if (status === "no") return "\u041D\u0435\u0442";
    if (status === "legacy") return notes;
    const rows = p.groups.find((g) => g.id === "enforcements")?.rows || [];
    const records = rows.map((row, index) => {
      const v = (key) => row.find((a) => a.key === key)?.value.trim() || "";
      return `${index + 1}. ${v("enforcementCreditor")} \u2014 ${v("enforcementAmount")} \u20B8${v("enforcementNote") ? "; " + v("enforcementNote") : ""}`;
    });
    if (notes && !/^нет[.!]?$/iu.test(notes)) records.push("\u041F\u0440\u0435\u0436\u043D\u0438\u0435 \u0441\u0432\u0435\u0434\u0435\u043D\u0438\u044F: " + notes);
    return records.join("; ");
  }
  return __toCommonJS(intake_data_exports);
})();
