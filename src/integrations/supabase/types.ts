export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assessment_comments: {
        Row: {
          assessment_id: string
          author_email: string | null
          author_name: string
          author_role: string
          body: string
          created_at: string
          id: string
          parent_id: string | null
          question_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          scope: string
          section_letter: string | null
          status: string
          target_key: string | null
          target_kind: string | null
          updated_at: string
        }
        Insert: {
          assessment_id: string
          author_email?: string | null
          author_name: string
          author_role?: string
          body: string
          created_at?: string
          id?: string
          parent_id?: string | null
          question_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scope: string
          section_letter?: string | null
          status?: string
          target_key?: string | null
          target_kind?: string | null
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          author_email?: string | null
          author_name?: string
          author_role?: string
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          question_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scope?: string
          section_letter?: string | null
          status?: string
          target_key?: string | null
          target_kind?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      assessment_questions: {
        Row: {
          answer: string | null
          ao_codes: string[]
          assessment_id: string
          bloom_level: string | null
          created_at: string
          diagram_caption: string | null
          diagram_citation: string | null
          diagram_source: string | null
          diagram_url: string | null
          difficulty: string | null
          id: string
          knowledge_outcomes: string[]
          learning_outcomes: string[]
          mark_scheme: string | null
          marks: number
          notes: string | null
          options: Json | null
          position: number
          question_type: string
          source_excerpt: string | null
          source_url: string | null
          stem: string
          topic: string | null
          updated_at: string
          user_id: string
          working: string | null
        }
        Insert: {
          answer?: string | null
          ao_codes?: string[]
          assessment_id: string
          bloom_level?: string | null
          created_at?: string
          diagram_caption?: string | null
          diagram_citation?: string | null
          diagram_source?: string | null
          diagram_url?: string | null
          difficulty?: string | null
          id?: string
          knowledge_outcomes?: string[]
          learning_outcomes?: string[]
          mark_scheme?: string | null
          marks?: number
          notes?: string | null
          options?: Json | null
          position?: number
          question_type: string
          source_excerpt?: string | null
          source_url?: string | null
          stem: string
          topic?: string | null
          updated_at?: string
          user_id: string
          working?: string | null
        }
        Update: {
          answer?: string | null
          ao_codes?: string[]
          assessment_id?: string
          bloom_level?: string | null
          created_at?: string
          diagram_caption?: string | null
          diagram_citation?: string | null
          diagram_source?: string | null
          diagram_url?: string | null
          difficulty?: string | null
          id?: string
          knowledge_outcomes?: string[]
          learning_outcomes?: string[]
          mark_scheme?: string | null
          marks?: number
          notes?: string | null
          options?: Json | null
          position?: number
          question_type?: string
          source_excerpt?: string | null
          source_url?: string | null
          stem?: string
          topic?: string | null
          updated_at?: string
          user_id?: string
          working?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_questions_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_versions: {
        Row: {
          assessment_id: string
          created_at: string
          id: string
          label: string | null
          snapshot: Json
          user_id: string
        }
        Insert: {
          assessment_id: string
          created_at?: string
          id?: string
          label?: string | null
          snapshot: Json
          user_id: string
        }
        Update: {
          assessment_id?: string
          created_at?: string
          id?: string
          label?: string | null
          snapshot?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_versions_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          assessment_type: string
          blueprint: Json | null
          created_at: string
          duration_minutes: number
          id: string
          instructions: string | null
          item_sources: Json | null
          level: string
          question_types: Json | null
          scoped_disciplines: string[] | null
          status: string
          subject: string
          syllabus_code: string | null
          syllabus_doc_id: string | null
          syllabus_paper_id: string | null
          title: string
          topics: Json | null
          total_marks: number
          updated_at: string
          user_id: string
        }
        Insert: {
          assessment_type: string
          blueprint?: Json | null
          created_at?: string
          duration_minutes?: number
          id?: string
          instructions?: string | null
          item_sources?: Json | null
          level: string
          question_types?: Json | null
          scoped_disciplines?: string[] | null
          status?: string
          subject: string
          syllabus_code?: string | null
          syllabus_doc_id?: string | null
          syllabus_paper_id?: string | null
          title: string
          topics?: Json | null
          total_marks?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          assessment_type?: string
          blueprint?: Json | null
          created_at?: string
          duration_minutes?: number
          id?: string
          instructions?: string | null
          item_sources?: Json | null
          level?: string
          question_types?: Json | null
          scoped_disciplines?: string[] | null
          status?: string
          subject?: string
          syllabus_code?: string | null
          syllabus_doc_id?: string | null
          syllabus_paper_id?: string | null
          title?: string
          topics?: Json | null
          total_marks?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_syllabus_doc_id_fkey"
            columns: ["syllabus_doc_id"]
            isOneToOne: false
            referencedRelation: "syllabus_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_syllabus_paper_id_fkey"
            columns: ["syllabus_paper_id"]
            isOneToOne: false
            referencedRelation: "syllabus_papers"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_set_papers: {
        Row: {
          created_at: string
          paper_id: string
          position: number
          set_id: string
        }
        Insert: {
          created_at?: string
          paper_id: string
          position?: number
          set_id: string
        }
        Update: {
          created_at?: string
          paper_id?: string
          position?: number
          set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_set_papers_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "past_papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_set_papers_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "paper_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_set_reviews: {
        Row: {
          created_at: string
          id: string
          model: string | null
          ran_at: string
          set_id: string
          snapshot: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          model?: string | null
          ran_at?: string
          set_id: string
          snapshot: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          model?: string | null
          ran_at?: string
          set_id?: string
          snapshot?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_set_reviews_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "paper_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_sets: {
        Row: {
          created_at: string
          id: string
          level: string | null
          notes: string | null
          scoped_disciplines: string[] | null
          subject: string | null
          syllabus_doc_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: string | null
          notes?: string | null
          scoped_disciplines?: string[] | null
          subject?: string | null
          syllabus_doc_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: string | null
          notes?: string | null
          scoped_disciplines?: string[] | null
          subject?: string | null
          syllabus_doc_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_sets_syllabus_doc_id_fkey"
            columns: ["syllabus_doc_id"]
            isOneToOne: false
            referencedRelation: "syllabus_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      past_paper_diagrams: {
        Row: {
          bbox: Json | null
          caption: string | null
          created_at: string
          id: string
          image_path: string
          page_number: number | null
          paper_id: string
          question_id: string | null
          topic_tags: string[] | null
        }
        Insert: {
          bbox?: Json | null
          caption?: string | null
          created_at?: string
          id?: string
          image_path: string
          page_number?: number | null
          paper_id: string
          question_id?: string | null
          topic_tags?: string[] | null
        }
        Update: {
          bbox?: Json | null
          caption?: string | null
          created_at?: string
          id?: string
          image_path?: string
          page_number?: number | null
          paper_id?: string
          question_id?: string | null
          topic_tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "past_paper_diagrams_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "past_papers"
            referencedColumns: ["id"]
          },
        ]
      }
      past_papers: {
        Row: {
          created_at: string
          difficulty_fingerprint: Json | null
          exam_board: string | null
          file_path: string
          id: string
          level: string | null
          notes: string | null
          page_count: number | null
          paper_number: string | null
          parse_error: string | null
          parse_status: string
          question_types: string[] | null
          questions_json: Json | null
          style_summary: string | null
          subject: string | null
          title: string
          topics: string[] | null
          updated_at: string
          user_id: string
          year: number | null
        }
        Insert: {
          created_at?: string
          difficulty_fingerprint?: Json | null
          exam_board?: string | null
          file_path: string
          id?: string
          level?: string | null
          notes?: string | null
          page_count?: number | null
          paper_number?: string | null
          parse_error?: string | null
          parse_status?: string
          question_types?: string[] | null
          questions_json?: Json | null
          style_summary?: string | null
          subject?: string | null
          title: string
          topics?: string[] | null
          updated_at?: string
          user_id: string
          year?: number | null
        }
        Update: {
          created_at?: string
          difficulty_fingerprint?: Json | null
          exam_board?: string | null
          file_path?: string
          id?: string
          level?: string | null
          notes?: string | null
          page_count?: number | null
          paper_number?: string | null
          parse_error?: string | null
          parse_status?: string
          question_types?: string[] | null
          questions_json?: Json | null
          style_summary?: string | null
          subject?: string | null
          title?: string
          topics?: string[] | null
          updated_at?: string
          user_id?: string
          year?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          levels: string[] | null
          school: string | null
          subjects: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          levels?: string[] | null
          school?: string | null
          subjects?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          levels?: string[] | null
          school?: string | null
          subjects?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      question_bank_items: {
        Row: {
          answer: string | null
          ao_codes: string[]
          bloom_level: string | null
          command_word: string | null
          created_at: string
          diagram_paths: string[]
          difficulty: string | null
          exam_board: string | null
          id: string
          knowledge_outcomes: string[]
          learning_outcomes: string[]
          level: string
          mark_scheme: string | null
          marks: number
          options: Json | null
          paper_number: string | null
          past_paper_id: string | null
          question_number: string | null
          question_type: string
          source: string | null
          source_excerpt: string | null
          stem: string
          subject: string
          syllabus_doc_id: string | null
          tags: string[] | null
          topic: string | null
          topic_code: string | null
          updated_at: string
          user_id: string
          year: number | null
        }
        Insert: {
          answer?: string | null
          ao_codes?: string[]
          bloom_level?: string | null
          command_word?: string | null
          created_at?: string
          diagram_paths?: string[]
          difficulty?: string | null
          exam_board?: string | null
          id?: string
          knowledge_outcomes?: string[]
          learning_outcomes?: string[]
          level: string
          mark_scheme?: string | null
          marks?: number
          options?: Json | null
          paper_number?: string | null
          past_paper_id?: string | null
          question_number?: string | null
          question_type: string
          source?: string | null
          source_excerpt?: string | null
          stem: string
          subject: string
          syllabus_doc_id?: string | null
          tags?: string[] | null
          topic?: string | null
          topic_code?: string | null
          updated_at?: string
          user_id: string
          year?: number | null
        }
        Update: {
          answer?: string | null
          ao_codes?: string[]
          bloom_level?: string | null
          command_word?: string | null
          created_at?: string
          diagram_paths?: string[]
          difficulty?: string | null
          exam_board?: string | null
          id?: string
          knowledge_outcomes?: string[]
          learning_outcomes?: string[]
          level?: string
          mark_scheme?: string | null
          marks?: number
          options?: Json | null
          paper_number?: string | null
          past_paper_id?: string | null
          question_number?: string | null
          question_type?: string
          source?: string | null
          source_excerpt?: string | null
          stem?: string
          subject?: string
          syllabus_doc_id?: string | null
          tags?: string[] | null
          topic?: string | null
          topic_code?: string | null
          updated_at?: string
          user_id?: string
          year?: number | null
        }
        Relationships: []
      }
      reference_materials: {
        Row: {
          created_at: string
          file_path: string
          id: string
          level: string | null
          mime_type: string | null
          parsed_content: string | null
          subject: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_path: string
          id?: string
          level?: string | null
          mime_type?: string | null
          parsed_content?: string | null
          subject?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_path?: string
          id?: string
          level?: string | null
          mime_type?: string | null
          parsed_content?: string | null
          subject?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      syllabus_assessment_objectives: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          paper_id: string | null
          position: number
          source_doc_id: string
          title: string | null
          updated_at: string
          weighting_percent: number | null
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          paper_id?: string | null
          position?: number
          source_doc_id: string
          title?: string | null
          updated_at?: string
          weighting_percent?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          paper_id?: string | null
          position?: number
          source_doc_id?: string
          title?: string | null
          updated_at?: string
          weighting_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_assessment_objectives_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "syllabus_papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_assessment_objectives_source_doc_id_fkey"
            columns: ["source_doc_id"]
            isOneToOne: false
            referencedRelation: "syllabus_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_documents: {
        Row: {
          aims: string | null
          assessment_rationale: string | null
          command_word_glossary: Json
          created_at: string
          exam_board: string | null
          file_path: string
          id: string
          level: string | null
          mime_type: string | null
          narrative_source_path: string | null
          notes: string | null
          paper_code: string | null
          parse_error: string | null
          parse_status: string
          pedagogical_notes: string | null
          raw_text: string | null
          skills_outcomes: Json
          subject: string | null
          syllabus_code: string | null
          syllabus_year: number | null
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          aims?: string | null
          assessment_rationale?: string | null
          command_word_glossary?: Json
          created_at?: string
          exam_board?: string | null
          file_path: string
          id?: string
          level?: string | null
          mime_type?: string | null
          narrative_source_path?: string | null
          notes?: string | null
          paper_code?: string | null
          parse_error?: string | null
          parse_status?: string
          pedagogical_notes?: string | null
          raw_text?: string | null
          skills_outcomes?: Json
          subject?: string | null
          syllabus_code?: string | null
          syllabus_year?: number | null
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          aims?: string | null
          assessment_rationale?: string | null
          command_word_glossary?: Json
          created_at?: string
          exam_board?: string | null
          file_path?: string
          id?: string
          level?: string | null
          mime_type?: string | null
          narrative_source_path?: string | null
          notes?: string | null
          paper_code?: string | null
          parse_error?: string | null
          parse_status?: string
          pedagogical_notes?: string | null
          raw_text?: string | null
          skills_outcomes?: Json
          subject?: string | null
          syllabus_code?: string | null
          syllabus_year?: number | null
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      syllabus_papers: {
        Row: {
          assessment_mode: string | null
          component_name: string | null
          created_at: string
          duration_minutes: number | null
          id: string
          is_optional: boolean
          marks: number | null
          paper_code: string | null
          paper_number: string
          position: number
          section: string | null
          source_doc_id: string
          topic_theme: string | null
          track_tags: string[] | null
          updated_at: string
          weighting_percent: number | null
        }
        Insert: {
          assessment_mode?: string | null
          component_name?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          is_optional?: boolean
          marks?: number | null
          paper_code?: string | null
          paper_number: string
          position?: number
          section?: string | null
          source_doc_id: string
          topic_theme?: string | null
          track_tags?: string[] | null
          updated_at?: string
          weighting_percent?: number | null
        }
        Update: {
          assessment_mode?: string | null
          component_name?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          is_optional?: boolean
          marks?: number | null
          paper_code?: string | null
          paper_number?: string
          position?: number
          section?: string | null
          source_doc_id?: string
          topic_theme?: string | null
          track_tags?: string[] | null
          updated_at?: string
          weighting_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_papers_source_doc_id_fkey"
            columns: ["source_doc_id"]
            isOneToOne: false
            referencedRelation: "syllabus_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_topic_papers: {
        Row: {
          created_at: string
          paper_id: string
          topic_id: string
        }
        Insert: {
          created_at?: string
          paper_id: string
          topic_id: string
        }
        Update: {
          created_at?: string
          paper_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_topic_papers_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "syllabus_papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_topic_papers_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "syllabus_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      syllabus_topics: {
        Row: {
          ao_codes: string[]
          created_at: string
          depth: number
          id: string
          ko_content: Json
          learning_outcome_code: string | null
          learning_outcomes: string[] | null
          level: string | null
          outcome_categories: string[]
          paper_id: string | null
          parent_code: string | null
          position: number
          section: string | null
          source_doc_id: string
          strand: string | null
          sub_strand: string | null
          subject: string | null
          suggested_blooms: string[] | null
          title: string
          topic_code: string | null
          updated_at: string
        }
        Insert: {
          ao_codes?: string[]
          created_at?: string
          depth?: number
          id?: string
          ko_content?: Json
          learning_outcome_code?: string | null
          learning_outcomes?: string[] | null
          level?: string | null
          outcome_categories?: string[]
          paper_id?: string | null
          parent_code?: string | null
          position?: number
          section?: string | null
          source_doc_id: string
          strand?: string | null
          sub_strand?: string | null
          subject?: string | null
          suggested_blooms?: string[] | null
          title: string
          topic_code?: string | null
          updated_at?: string
        }
        Update: {
          ao_codes?: string[]
          created_at?: string
          depth?: number
          id?: string
          ko_content?: Json
          learning_outcome_code?: string | null
          learning_outcomes?: string[] | null
          level?: string | null
          outcome_categories?: string[]
          paper_id?: string | null
          parent_code?: string | null
          position?: number
          section?: string | null
          source_doc_id?: string
          strand?: string | null
          sub_strand?: string | null
          subject?: string | null
          suggested_blooms?: string[] | null
          title?: string
          topic_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "syllabus_topics_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "syllabus_papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "syllabus_topics_source_doc_id_fkey"
            columns: ["source_doc_id"]
            isOneToOne: false
            referencedRelation: "syllabus_documents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
