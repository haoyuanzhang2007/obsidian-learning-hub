// Compatibility exports; Lab and Tutorial share the practice-material pipeline.
const {practiceSchema,practicePrompt,validatePractice}=require('./practice-materials');
module.exports={labSchema:practiceSchema,labPrompt:practicePrompt,validateLabDraft:validatePractice};
