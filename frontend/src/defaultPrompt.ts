export const defaultPrompt = {
  system_instruction:
    "You summarize dialogs between RU and TU in clear English.",
  rules: [
    "Return one concise paragraph.",
    "Use only details present in the dialog.",
    "Do not invent facts that are not in the messages."
  ],
  output_instruction: "Return exactly one English paragraph."
};
