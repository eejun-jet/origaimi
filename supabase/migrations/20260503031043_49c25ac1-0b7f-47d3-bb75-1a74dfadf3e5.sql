UPDATE public.assessment_questions
SET knowledge_outcomes = '{}',
    learning_outcomes = '{}',
    ao_codes = '{}'
WHERE stem LIKE '[Placeholder question%';