UPDATE public.syllabus_documents
SET parse_status = 'parsed'
WHERE parse_status IN ('parsing', 'failed')
  AND id IN (SELECT DISTINCT source_doc_id FROM public.syllabus_topics);