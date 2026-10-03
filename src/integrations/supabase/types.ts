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
      ai_usage: {
        Row: {
          cost_usd: number
          created_at: string
          fn: string
          id: string
          input_tokens: number
          model: string
          ok: boolean
          org_id: string | null
          output_tokens: number
          provider: string
          user_id: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          fn: string
          id?: string
          input_tokens?: number
          model?: string
          ok?: boolean
          org_id?: string | null
          output_tokens?: number
          provider: string
          user_id: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          fn?: string
          id?: string
          input_tokens?: number
          model?: string
          ok?: boolean
          org_id?: string | null
          output_tokens?: number
          provider?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          board_id: string
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
        }
        Insert: {
          board_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
        }
        Update: {
          board_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      app_permissions: {
        Row: {
          app_id: string
          created_at: string
          created_by: string | null
          id: string
          role: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          app_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          role: string
          subject_id: string
          subject_type: string
        }
        Update: {
          app_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          role?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_permissions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      apps: {
        Row: {
          access_expires_at: string | null
          access_mode: string
          access_revoked_at: string | null
          audience: string
          board_id: string
          branding: Json
          channels: Json
          created_at: string
          description: string
          id: string
          is_public: boolean
          kind: string
          last_access_at: string | null
          lead_question: string
          mcp_scope: string
          mcp_token: string
          node_ids: Json
          org_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_expires_at?: string | null
          access_mode?: string
          access_revoked_at?: string | null
          audience?: string
          board_id: string
          branding?: Json
          channels?: Json
          created_at?: string
          description?: string
          id?: string
          is_public?: boolean
          kind?: string
          last_access_at?: string | null
          lead_question?: string
          mcp_scope?: string
          mcp_token?: string
          node_ids?: Json
          org_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_expires_at?: string | null
          access_mode?: string
          access_revoked_at?: string | null
          audience?: string
          board_id?: string
          branding?: Json
          channels?: Json
          created_at?: string
          description?: string
          id?: string
          is_public?: boolean
          kind?: string
          last_access_at?: string | null
          lead_question?: string
          mcp_scope?: string
          mcp_token?: string
          node_ids?: Json
          org_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apps_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: string | null
          id: string
          object_id: string | null
          object_type: string | null
          subject_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          object_id?: string | null
          object_type?: string | null
          subject_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          object_id?: string | null
          object_type?: string | null
          subject_user_id?: string | null
        }
        Relationships: []
      }
      board_invites: {
        Row: {
          board_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: string
          status: string
          token: string
        }
        Insert: {
          board_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: string
          status?: string
          token?: string
        }
        Update: {
          board_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_invites_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      board_members: {
        Row: {
          board_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_members_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      board_team_access: {
        Row: {
          board_id: string
          created_at: string
          id: string
          role: string
          team_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          role?: string
          team_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          role?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_team_access_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_team_access_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      board_versions: {
        Row: {
          board_id: string
          created_at: string
          created_by: string | null
          edge_count: number
          id: string
          kind: string
          label: string | null
          node_count: number
          snapshot: Json
        }
        Insert: {
          board_id: string
          created_at?: string
          created_by?: string | null
          edge_count?: number
          id?: string
          kind?: string
          label?: string | null
          node_count?: number
          snapshot: Json
        }
        Update: {
          board_id?: string
          created_at?: string
          created_by?: string | null
          edge_count?: number
          id?: string
          kind?: string
          label?: string | null
          node_count?: number
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "board_versions_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          org_id: string | null
          project: string | null
          provenance: Json
          rules: Json
          share_expires_at: string | null
          share_last_used_at: string | null
          share_password_hash: string | null
          share_revoked_at: string | null
          share_token: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          org_id?: string | null
          project?: string | null
          provenance?: Json
          rules?: Json
          share_expires_at?: string | null
          share_last_used_at?: string | null
          share_password_hash?: string | null
          share_revoked_at?: string | null
          share_token?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          org_id?: string | null
          project?: string | null
          provenance?: Json
          rules?: Json
          share_expires_at?: string | null
          share_last_used_at?: string | null
          share_password_hash?: string | null
          share_revoked_at?: string | null
          share_token?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boards_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      captures: {
        Row: {
          app_id: string | null
          board_id: string
          created_at: string
          created_by: string | null
          id: string
          lat: number | null
          lon: number | null
          node_id: string
          photo_path: string | null
          source: string
        }
        Insert: {
          app_id?: string | null
          board_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lat?: number | null
          lon?: number | null
          node_id: string
          photo_path?: string | null
          source?: string
        }
        Update: {
          app_id?: string | null
          board_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lat?: number | null
          lon?: number | null
          node_id?: string
          photo_path?: string | null
          source?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          node_id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          node_id: string
          role: string
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          node_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      dataset_rows: {
        Row: {
          data: Json
          dataset_id: string
          id: number
          lat: number | null
          lon: number | null
          row_index: number
        }
        Insert: {
          data?: Json
          dataset_id: string
          id?: never
          lat?: number | null
          lon?: number | null
          row_index: number
        }
        Update: {
          data?: Json
          dataset_id?: string
          id?: never
          lat?: number | null
          lon?: number | null
          row_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "dataset_rows_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      datasets: {
        Row: {
          board_id: string
          checksum: string
          created_at: string
          created_by: string | null
          fetched_at: string | null
          id: string
          node_id: string | null
          origin_kind: string
          row_count: number
          schema: Json
          source_url: string | null
          storage_path: string | null
          verified: boolean
          version: number
        }
        Insert: {
          board_id: string
          checksum?: string
          created_at?: string
          created_by?: string | null
          fetched_at?: string | null
          id?: string
          node_id?: string | null
          origin_kind?: string
          row_count?: number
          schema?: Json
          source_url?: string | null
          storage_path?: string | null
          verified?: boolean
          version?: number
        }
        Update: {
          board_id?: string
          checksum?: string
          created_at?: string
          created_by?: string | null
          fetched_at?: string | null
          id?: string
          node_id?: string | null
          origin_kind?: string
          row_count?: number
          schema?: Json
          source_url?: string | null
          storage_path?: string | null
          verified?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "datasets_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "datasets_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_journal: {
        Row: {
          board_id: string
          confidence: number | null
          context_checksum: string
          created_at: string
          engine: string
          human_confidence: number | null
          human_confidence_by: string | null
          id: string
          min_confidence: number
          node_id: string
          ontology_digest: string
          outcome: string | null
          outcome_at: string | null
          outcome_by: string | null
          outcome_note: string | null
          probability: number | null
          provider: string
          question_id: string
          question_text: string
          question_type: string
          user_id: string
          verdict: string
        }
        Insert: {
          board_id: string
          confidence?: number | null
          context_checksum?: string
          created_at?: string
          engine?: string
          human_confidence?: number | null
          human_confidence_by?: string | null
          id?: string
          min_confidence?: number
          node_id: string
          ontology_digest?: string
          outcome?: string | null
          outcome_at?: string | null
          outcome_by?: string | null
          outcome_note?: string | null
          probability?: number | null
          provider?: string
          question_id: string
          question_text?: string
          question_type?: string
          user_id: string
          verdict?: string
        }
        Update: {
          board_id?: string
          confidence?: number | null
          context_checksum?: string
          created_at?: string
          engine?: string
          human_confidence?: number | null
          human_confidence_by?: string | null
          id?: string
          min_confidence?: number
          node_id?: string
          ontology_digest?: string
          outcome?: string | null
          outcome_at?: string | null
          outcome_by?: string | null
          outcome_note?: string | null
          probability?: number | null
          provider?: string
          question_id?: string
          question_text?: string
          question_type?: string
          user_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_journal_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_journal_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      edges: {
        Row: {
          board_id: string
          created_at: string
          id: string
          label: string | null
          source_id: string
          target_id: string
          user_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          label?: string | null
          source_id: string
          target_id: string
          user_id?: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          label?: string | null
          source_id?: string
          target_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          board_id: string | null
          board_role: string
          created_at: string
          email: string
          email_sent_at: string | null
          expires_at: string
          id: string
          invited_by: string
          org_id: string | null
          org_role: Database["public"]["Enums"]["org_role"]
          status: string
          team_id: string | null
          token: string
        }
        Insert: {
          board_id?: string | null
          board_role?: string
          created_at?: string
          email: string
          email_sent_at?: string | null
          expires_at?: string
          id?: string
          invited_by: string
          org_id?: string | null
          org_role?: Database["public"]["Enums"]["org_role"]
          status?: string
          team_id?: string | null
          token?: string
        }
        Update: {
          board_id?: string | null
          board_role?: string
          created_at?: string
          email?: string
          email_sent_at?: string | null
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string | null
          org_role?: Database["public"]["Enums"]["org_role"]
          status?: string
          team_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_servers: {
        Row: {
          auth_kind: string
          created_at: string
          encrypted_token: string | null
          header_name: string | null
          id: string
          last_check_at: string | null
          last_error: string | null
          name: string
          server_info: Json
          tools: Json
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          auth_kind?: string
          created_at?: string
          encrypted_token?: string | null
          header_name?: string | null
          id?: string
          last_check_at?: string | null
          last_error?: string | null
          name: string
          server_info?: Json
          tools?: Json
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          auth_kind?: string
          created_at?: string
          encrypted_token?: string | null
          header_name?: string | null
          id?: string
          last_check_at?: string | null
          last_error?: string | null
          name?: string
          server_info?: Json
          tools?: Json
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      module_library: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          org_id: string | null
          payload: Json
          scope: string
          share_token: string
          tags: string[]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          org_id?: string | null
          payload?: Json
          scope?: string
          share_token?: string
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          org_id?: string | null
          payload?: Json
          scope?: string
          share_token?: string
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_library_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      module_library_shares: {
        Row: {
          created_at: string
          email: string | null
          id: string
          library_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          library_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          library_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_library_shares_library_id_fkey"
            columns: ["library_id"]
            isOneToOne: false
            referencedRelation: "module_library"
            referencedColumns: ["id"]
          },
        ]
      }
      node_comments: {
        Row: {
          board_id: string
          body: string
          created_at: string
          id: string
          node_id: string
          resolved_at: string | null
          user_id: string
        }
        Insert: {
          board_id: string
          body: string
          created_at?: string
          id?: string
          node_id: string
          resolved_at?: string | null
          user_id: string
        }
        Update: {
          board_id?: string
          body?: string
          created_at?: string
          id?: string
          node_id?: string
          resolved_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_comments_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_comments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      node_permissions: {
        Row: {
          board_id: string
          created_at: string
          created_by: string | null
          id: string
          node_id: string
          role: string
          subject_id: string | null
          subject_type: string
        }
        Insert: {
          board_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          node_id: string
          role: string
          subject_id?: string | null
          subject_type: string
        }
        Update: {
          board_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          node_id?: string
          role?: string
          subject_id?: string | null
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_permissions_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_permissions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          board_id: string
          color: string | null
          content: string | null
          created_at: string
          error: string | null
          height: number
          id: string
          metadata: Json
          mime_type: string | null
          parent_id: string | null
          position_x: number
          position_y: number
          source_url: string | null
          status: string
          storage_path: string | null
          title: string
          type: string
          updated_at: string
          user_id: string
          width: number
        }
        Insert: {
          board_id: string
          color?: string | null
          content?: string | null
          created_at?: string
          error?: string | null
          height?: number
          id?: string
          metadata?: Json
          mime_type?: string | null
          parent_id?: string | null
          position_x?: number
          position_y?: number
          source_url?: string | null
          status?: string
          storage_path?: string | null
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
          width?: number
        }
        Update: {
          board_id?: string
          color?: string | null
          content?: string | null
          created_at?: string
          error?: string | null
          height?: number
          id?: string
          metadata?: Json
          mime_type?: string | null
          parent_id?: string | null
          position_x?: number
          position_y?: number
          source_url?: string | null
          status?: string
          storage_path?: string | null
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "nodes_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          branding: Json
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          branding?: Json
          created_at?: string
          created_by: string
          id?: string
          name?: string
          updated_at?: string
        }
        Update: {
          branding?: Json
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          blocked_at: string | null
          created_at: string
          deletion_requested_at: string | null
          display_name: string | null
          email: string | null
          id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          blocked_at?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          display_name?: string | null
          email?: string | null
          id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          blocked_at?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      query_templates: {
        Row: {
          category: string
          columns: string[]
          config: Json
          created_at: string
          id: string
          last_used_at: string | null
          tags: string[]
          title: string
          user_id: string
        }
        Insert: {
          category?: string
          columns?: string[]
          config: Json
          created_at?: string
          id?: string
          last_used_at?: string | null
          tags?: string[]
          title: string
          user_id: string
        }
        Update: {
          category?: string
          columns?: string[]
          config?: Json
          created_at?: string
          id?: string
          last_used_at?: string | null
          tags?: string[]
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      run_events: {
        Row: {
          action: string
          actor_id: string | null
          board_id: string
          created_at: string
          detail: string | null
          id: string
          run_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          board_id: string
          created_at?: string
          detail?: string | null
          id?: string
          run_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          board_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          run_id?: string
        }
        Relationships: []
      }
      runs: {
        Row: {
          api_key_id: string | null
          app_id: string | null
          board_id: string
          context_checksum: string
          created_at: string
          engine: string
          error: string | null
          expires_at: string
          finished_at: string | null
          id: string
          input_mime: string | null
          input_path: string | null
          input_refs: Json
          input_sha256: string | null
          model: string
          origin: string
          output_node_id: string
          provider: string
          purged_at: string | null
          result: Json
          result_sha256: string
          status: string
          user_id: string | null
        }
        Insert: {
          api_key_id?: string | null
          app_id?: string | null
          board_id: string
          context_checksum?: string
          created_at?: string
          engine?: string
          error?: string | null
          expires_at?: string
          finished_at?: string | null
          id?: string
          input_mime?: string | null
          input_path?: string | null
          input_refs?: Json
          input_sha256?: string | null
          model?: string
          origin?: string
          output_node_id: string
          provider?: string
          purged_at?: string | null
          result?: Json
          result_sha256?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          api_key_id?: string | null
          app_id?: string | null
          board_id?: string
          context_checksum?: string
          created_at?: string
          engine?: string
          error?: string | null
          expires_at?: string
          finished_at?: string | null
          id?: string
          input_mime?: string | null
          input_path?: string | null
          input_refs?: Json
          input_sha256?: string | null
          model?: string
          origin?: string
          output_node_id?: string
          provider?: string
          purged_at?: string | null
          result?: Json
          result_sha256?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runs_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_output_node_id_fkey"
            columns: ["output_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      scope_triggers: {
        Row: {
          board_id: string
          conditions: Json
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          interval_minutes: number | null
          last_detail: string | null
          last_event_at: string | null
          last_run_at: string | null
          last_status: string | null
          last_values: Json
          log_exclude: string[]
          log_values: boolean
          match_mode: string
          mode: string
          name: string
          next_run_at: string | null
          node_id: string
          prefix: string
          probe_url: string | null
          secret_hash: string
          updated_at: string
        }
        Insert: {
          board_id: string
          conditions?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          interval_minutes?: number | null
          last_detail?: string | null
          last_event_at?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_values?: Json
          log_exclude?: string[]
          log_values?: boolean
          match_mode?: string
          mode?: string
          name?: string
          next_run_at?: string | null
          node_id: string
          prefix?: string
          probe_url?: string | null
          secret_hash: string
          updated_at?: string
        }
        Update: {
          board_id?: string
          conditions?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          interval_minutes?: number | null
          last_detail?: string | null
          last_event_at?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_values?: Json
          log_exclude?: string[]
          log_values?: boolean
          match_mode?: string
          mode?: string
          name?: string
          next_run_at?: string | null
          node_id?: string
          prefix?: string
          probe_url?: string | null
          secret_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scope_triggers_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_triggers_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          org_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          created_at: string
          description: string | null
          fields: Json
          id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          fields?: Json
          id?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          fields?: Json
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      trigger_events: {
        Row: {
          board_id: string
          created_at: string
          id: string
          reason: string
          runs: number
          source: string
          status: string
          trigger_id: string | null
          trigger_name: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          reason?: string
          runs?: number
          source: string
          status: string
          trigger_id?: string | null
          trigger_name?: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          reason?: string
          runs?: number
          source?: string
          status?: string
          trigger_id?: string | null
          trigger_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "trigger_events_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "scope_triggers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ai_keys: {
        Row: {
          base_url: string | null
          created_at: string
          encrypted_key: string
          id: string
          last4: string
          model_hint: string | null
          provider: Database["public"]["Enums"]["ai_provider"]
          updated_at: string
          user_id: string
        }
        Insert: {
          base_url?: string | null
          created_at?: string
          encrypted_key: string
          id?: string
          last4?: string
          model_hint?: string | null
          provider: Database["public"]["Enums"]["ai_provider"]
          updated_at?: string
          user_id: string
        }
        Update: {
          base_url?: string | null
          created_at?: string
          encrypted_key?: string
          id?: string
          last4?: string
          model_hint?: string | null
          provider?: Database["public"]["Enums"]["ai_provider"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_consents: {
        Row: {
          granted: boolean
          id: string
          purpose: string
          updated_at: string
          user_id: string
          version: string
        }
        Insert: {
          granted?: boolean
          id?: string
          purpose: string
          updated_at?: string
          user_id: string
          version?: string
        }
        Update: {
          granted?: boolean
          id?: string
          purpose?: string
          updated_at?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      dataset_aggregate:
        | {
            Args: {
              _dataset: string
              _filters?: Json
              _fn?: string
              _group_by?: string
              _measure?: string
            }
            Returns: {
              bucket: string
              cnt: number
              matched: number
              total: number
              value: number
            }[]
          }
        | {
            Args: {
              _dataset: string
              _filters?: Json
              _fn?: string
              _group_by?: string
              _limit?: number
              _measure?: string
              _sort?: string
            }
            Returns: {
              bucket: string
              cnt: number
              matched: number
              total: number
              value: number
            }[]
          }
      dataset_bbox: {
        Args: {
          _dataset: string
          _east?: number
          _limit?: number
          _name_col?: string
          _north?: number
          _south?: number
          _west?: number
        }
        Returns: {
          lat: number
          lon: number
          matched: number
          name: string
          row_index: number
          total: number
        }[]
      }
      dataset_query_rows: {
        Args: {
          _columns?: string[]
          _dataset: string
          _filters?: Json
          _limit?: number
          _offset?: number
        }
        Returns: {
          data: Json
          matched: number
          row_index: number
          total: number
        }[]
      }
      dataset_rule_check: {
        Args: {
          _column: string
          _dataset: string
          _operator: string
          _value?: Json
        }
        Returns: {
          failed: number
          failed_rows: number[]
          passed: number
          total: number
        }[]
      }
      dataset_sql: {
        Args: { _dataset: string; _sql: string }
        Returns: {
          row_json: Json
        }[]
      }
      end_user_sessions: {
        Args: { _session?: string; _user: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_user_sessions: {
        Args: { _user: string }
        Returns: {
          created_at: string
          id: string
          refreshed_at: string
          user_agent: string
        }[]
      }
      purge_audit_log: { Args: never; Returns: undefined }
      verify_cron_token: {
        Args: { _name: string; _token: string }
        Returns: boolean
      }
    }
    Enums: {
      ai_provider: "openai" | "anthropic" | "google" | "openrouter"
      app_role: "admin" | "user" | "developer"
      org_role: "owner" | "admin" | "member" | "guest"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_provider: ["openai", "anthropic", "google", "openrouter"],
      app_role: ["admin", "user", "developer"],
      org_role: ["owner", "admin", "member", "guest"],
    },
  },
} as const
