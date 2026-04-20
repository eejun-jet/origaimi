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
      assessment_questions: {
        Row: {
          answer: string | null
          assessment_id: string
          bloom_level: string | null
          created_at: string
          difficulty: string | null
          id: string
          mark_scheme: string | null
          marks: number
          notes: string | null
          options: Json | null
          position: number
          question_type: string
          stem: string
          topic: string | null
          updated_at: string
          user_id: string
          working: string | null
        }
        Insert: {
          answer?: string | null
          assessment_id: string
          bloom_level?: string | null
          created_at?: string
          difficulty?: string | null
          id?: string
          mark_scheme?: string | null
          marks?: number
          notes?: string | null
          options?: Json | null
          position?: number
          question_type: string
          stem: string
          topic?: string | null
          updated_at?: string
          user_id: string
          working?: string | null
        }
        Update: {
          answer?: string | null
          assessment_id?: string
          bloom_level?: string | null
          created_at?: string
          difficulty?: string | null
          id?: string
          mark_scheme?: string | null
          marks?: number
          notes?: string | null
          options?: Json | null
          position?: number
          question_type?: string
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
          status: string
          subject: string
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
          status?: string
          subject: string
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
          status?: string
          subject?: string
          title?: string
          topics?: Json | null
          total_marks?: number
          updated_at?: string
          user_id?: string
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
          bloom_level: string | null
          created_at: string
          difficulty: string | null
          id: string
          level: string
          mark_scheme: string | null
          marks: number
          options: Json | null
          question_type: string
          source: string | null
          stem: string
          subject: string
          tags: string[] | null
          topic: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          answer?: string | null
          bloom_level?: string | null
          created_at?: string
          difficulty?: string | null
          id?: string
          level: string
          mark_scheme?: string | null
          marks?: number
          options?: Json | null
          question_type: string
          source?: string | null
          stem: string
          subject: string
          tags?: string[] | null
          topic?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          answer?: string | null
          bloom_level?: string | null
          created_at?: string
          difficulty?: string | null
          id?: string
          level?: string
          mark_scheme?: string | null
          marks?: number
          options?: Json | null
          question_type?: string
          source?: string | null
          stem?: string
          subject?: string
          tags?: string[] | null
          topic?: string | null
          updated_at?: string
          user_id?: string
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
      syllabus_documents: {
        Row: {
          created_at: string
          exam_board: string | null
          file_path: string
          id: string
          level: string | null
          mime_type: string | null
          notes: string | null
          paper_code: string | null
          parse_error: string | null
          parse_status: string
          raw_text: string | null
          subject: string | null
          syllabus_code: string | null
          syllabus_year: number | null
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          exam_board?: string | null
          file_path: string
          id?: string
          level?: string | null
          mime_type?: string | null
          notes?: string | null
          paper_code?: string | null
          parse_error?: string | null
          parse_status?: string
          raw_text?: string | null
          subject?: string | null
          syllabus_code?: string | null
          syllabus_year?: number | null
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          exam_board?: string | null
          file_path?: string
          id?: string
          level?: string | null
          mime_type?: string | null
          notes?: string | null
          paper_code?: string | null
          parse_error?: string | null
          parse_status?: string
          raw_text?: string | null
          subject?: string | null
          syllabus_code?: string | null
          syllabus_year?: number | null
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      syllabus_topics: {
        Row: {
          created_at: string
          depth: number
          id: string
          learning_outcome_code: string | null
          learning_outcomes: string[] | null
          level: string | null
          parent_code: string | null
          position: number
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
          created_at?: string
          depth?: number
          id?: string
          learning_outcome_code?: string | null
          learning_outcomes?: string[] | null
          level?: string | null
          parent_code?: string | null
          position?: number
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
          created_at?: string
          depth?: number
          id?: string
          learning_outcome_code?: string | null
          learning_outcomes?: string[] | null
          level?: string | null
          parent_code?: string | null
          position?: number
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
