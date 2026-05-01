UPDATE public.syllabus_documents
SET parse_status = 'pending', updated_at = now()
WHERE id = 'c5c857bf-c95b-4d43-b317-4589f872c77b' AND parse_status = 'parsing';