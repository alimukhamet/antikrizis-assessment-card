/* The questionnaire keeps every field; only the two document gates move to the handoff. */
const contractRequiredDocuments=requiredDocumentLabels;
requiredDocumentLabels=()=>contractRequiredDocuments().filter(type=>!['ЭЦП файл','Доверенность'].includes(type));
documentTypes.push('Подписанный договор');
const operationsStyles=document.createElement('link');operationsStyles.rel='stylesheet';operationsStyles.href='/operations.css';document.head.append(operationsStyles);
