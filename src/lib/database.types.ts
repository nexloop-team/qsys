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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity: string
          entity_id: string | null
          id: number
          org_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity: string
          entity_id?: string | null
          id?: never
          org_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity?: string
          entity_id?: string | null
          id?: never
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          handled_by: string | null
          id: string
          minutes: number
          name: string
          note: string | null
          org_id: string
          phone: string
          players: number
          source: string
          starts_at: string
          station_id: string | null
          station_type: Database["public"]["Enums"]["station_type"]
          status: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          handled_by?: string | null
          id?: string
          minutes: number
          name: string
          note?: string | null
          org_id: string
          phone: string
          players?: number
          source?: string
          starts_at: string
          station_id?: string | null
          station_type: Database["public"]["Enums"]["station_type"]
          status?: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          handled_by?: string | null
          id?: string
          minutes?: number
          name?: string
          note?: string | null
          org_id?: string
          phone?: string
          players?: number
          source?: string
          starts_at?: string
          station_id?: string | null
          station_type?: Database["public"]["Enums"]["station_type"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_settings: {
        Row: {
          allowed_modes_by_type: Json
          blocked_apps: string[]
          booking_days: number
          booking_enabled: boolean
          booking_note: string | null
          booking_slug: string | null
          branch_id: string
          credit_limit: number | null
          default_mode_by_type: Json
          early_end_policy: string
          gst_enabled: boolean
          gst_rate: number
          gstin: string | null
          invoice_prefix: string
          leftover_keep_days: number
          leftover_policy: Database["public"]["Enums"]["leftover_policy"]
          lock_message: string | null
          org_id: string
          overtime_grace_minutes: number
          pc_games: Json
          pc_player_login: boolean
          pc_restrictions: string[]
          per_person_types: Database["public"]["Enums"]["station_type"][]
          prices_include_tax: boolean
          qr_enabled: boolean
          qr_orders: boolean
          staff_max_discount_pct: number
          station_types: Database["public"]["Enums"]["station_type"][]
          updated_at: string
          upi_payee_name: string | null
          upi_vpa: string | null
        }
        Insert: {
          allowed_modes_by_type?: Json
          blocked_apps?: string[]
          booking_days?: number
          booking_enabled?: boolean
          booking_note?: string | null
          booking_slug?: string | null
          branch_id: string
          credit_limit?: number | null
          default_mode_by_type?: Json
          early_end_policy?: string
          gst_enabled?: boolean
          gst_rate?: number
          gstin?: string | null
          invoice_prefix?: string
          leftover_keep_days?: number
          leftover_policy?: Database["public"]["Enums"]["leftover_policy"]
          lock_message?: string | null
          org_id: string
          overtime_grace_minutes?: number
          pc_games?: Json
          pc_player_login?: boolean
          pc_restrictions?: string[]
          per_person_types?: Database["public"]["Enums"]["station_type"][]
          prices_include_tax?: boolean
          qr_enabled?: boolean
          qr_orders?: boolean
          staff_max_discount_pct?: number
          station_types?: Database["public"]["Enums"]["station_type"][]
          updated_at?: string
          upi_payee_name?: string | null
          upi_vpa?: string | null
        }
        Update: {
          allowed_modes_by_type?: Json
          blocked_apps?: string[]
          booking_days?: number
          booking_enabled?: boolean
          booking_note?: string | null
          booking_slug?: string | null
          branch_id?: string
          credit_limit?: number | null
          default_mode_by_type?: Json
          early_end_policy?: string
          gst_enabled?: boolean
          gst_rate?: number
          gstin?: string | null
          invoice_prefix?: string
          leftover_keep_days?: number
          leftover_policy?: Database["public"]["Enums"]["leftover_policy"]
          lock_message?: string | null
          org_id?: string
          overtime_grace_minutes?: number
          pc_games?: Json
          pc_player_login?: boolean
          pc_restrictions?: string[]
          per_person_types?: Database["public"]["Enums"]["station_type"][]
          prices_include_tax?: boolean
          qr_enabled?: boolean
          qr_orders?: boolean
          staff_max_discount_pct?: number
          station_types?: Database["public"]["Enums"]["station_type"][]
          updated_at?: string
          upi_payee_name?: string | null
          upi_vpa?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_settings_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          closing_time: string | null
          created_at: string
          id: string
          name: string
          opening_time: string | null
          org_id: string
          phone: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          closing_time?: string | null
          created_at?: string
          id?: string
          name: string
          opening_time?: string | null
          org_id: string
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          closing_time?: string | null
          created_at?: string
          id?: string
          name?: string
          opening_time?: string | null
          org_id?: string
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string | null
          id: string
          message: string
          name: string
          phone: string | null
          sender_hash: string | null
          topic: string
          user_id: string | null
          venue: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          message: string
          name: string
          phone?: string | null
          sender_hash?: string | null
          topic: string
          user_id?: string | null
          venue?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          name?: string
          phone?: string | null
          sender_hash?: string | null
          topic?: string
          user_id?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          created_by: string | null
          credit_limit: number | null
          id: string
          name: string
          org_id: string
          phone: string
          pin_failed: number
          pin_hash: string | null
          pin_locked_until: string | null
          pin_lockouts: number
          pin_set: boolean | null
          updated_at: string
          wallet_balance: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          id?: string
          name: string
          org_id: string
          phone: string
          pin_failed?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          pin_lockouts?: number
          pin_set?: boolean | null
          updated_at?: string
          wallet_balance?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          id?: string
          name?: string
          org_id?: string
          phone?: string
          pin_failed?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          pin_lockouts?: number
          pin_set?: boolean | null
          updated_at?: string
          wallet_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          agent_version: string | null
          branch_id: string
          channel: string
          created_at: string
          health: Json | null
          health_at: string | null
          hostname: string | null
          id: string
          ip: string | null
          last_seen_at: string | null
          mac: string | null
          org_id: string
          os: string | null
          paired_by: string | null
          screen_locked: boolean | null
          staff_pin_failed: number
          staff_pin_hash: string | null
          staff_pin_locked_until: string | null
          staff_pin_lockouts: number
          station_id: string
          token_hash: string
        }
        Insert: {
          agent_version?: string | null
          branch_id: string
          channel?: string
          created_at?: string
          health?: Json | null
          health_at?: string | null
          hostname?: string | null
          id?: string
          ip?: string | null
          last_seen_at?: string | null
          mac?: string | null
          org_id: string
          os?: string | null
          paired_by?: string | null
          screen_locked?: boolean | null
          staff_pin_failed?: number
          staff_pin_hash?: string | null
          staff_pin_locked_until?: string | null
          staff_pin_lockouts?: number
          station_id: string
          token_hash: string
        }
        Update: {
          agent_version?: string | null
          branch_id?: string
          channel?: string
          created_at?: string
          health?: Json | null
          health_at?: string | null
          hostname?: string | null
          id?: string
          ip?: string | null
          last_seen_at?: string | null
          mac?: string | null
          org_id?: string
          os?: string | null
          paired_by?: string | null
          screen_locked?: boolean | null
          staff_pin_failed?: number
          staff_pin_hash?: string | null
          staff_pin_locked_until?: string | null
          staff_pin_lockouts?: number
          station_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "devices_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: true
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          branch_id: string
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          id: string
          name: string
          note: string | null
          org_id: string
          repeats_monthly: boolean
          spent_on: string
          staff_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          branch_id: string
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          note?: string | null
          org_id: string
          repeats_monthly?: boolean
          spent_on: string
          staff_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          branch_id?: string
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          note?: string | null
          org_id?: string
          repeats_monthly?: boolean
          spent_on?: string
          staff_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_org_id_staff_id_fkey"
            columns: ["org_id", "staff_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["org_id", "user_id"]
          },
        ]
      }
      invoice_counters: {
        Row: {
          branch_id: string
          next_seq: number
          series: string
        }
        Insert: {
          branch_id: string
          next_seq: number
          series: string
        }
        Update: {
          branch_id?: string
          next_seq?: number
          series?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_counters_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          amount: number
          description: string
          gst_rate: number
          id: string
          invoice_id: string
          minutes: number | null
          org_id: string
          product_id: string | null
          quantity: number | null
          session_id: string | null
          unit_cost: number | null
        }
        Insert: {
          amount: number
          description: string
          gst_rate?: number
          id?: string
          invoice_id: string
          minutes?: number | null
          org_id: string
          product_id?: string | null
          quantity?: number | null
          session_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          amount?: number
          description?: string
          gst_rate?: number
          id?: string
          invoice_id?: string
          minutes?: number | null
          org_id?: string
          product_id?: string | null
          quantity?: number | null
          session_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          branch_id: string
          cgst: number
          created_at: string
          created_by: string | null
          customer_name: string | null
          customer_phone: string | null
          discount: number
          discount_reason: string | null
          gst_enabled: boolean
          gstin: string | null
          id: string
          number: string
          org_id: string
          prices_include_tax: boolean
          sgst: number
          subtotal: number
          taxable_amount: number
          total: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          branch_id: string
          cgst?: number
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          discount_reason?: string | null
          gst_enabled: boolean
          gstin?: string | null
          id?: string
          number: string
          org_id: string
          prices_include_tax: boolean
          sgst?: number
          subtotal: number
          taxable_amount: number
          total: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          branch_id?: string
          cgst?: number
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          discount_reason?: string | null
          gst_enabled?: boolean
          gstin?: string | null
          id?: string
          number?: string
          org_id?: string
          prices_include_tax?: boolean
          sgst?: number
          subtotal?: number
          taxable_amount?: number
          total?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          spend_bonus_pct: number
          updated_at: string
          wallet_offers: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          spend_bonus_pct?: number
          updated_at?: string
          wallet_offers?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          spend_bonus_pct?: number
          updated_at?: string
          wallet_offers?: Json
        }
        Relationships: []
      }
      packages: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          minutes: number
          name: string
          org_id: string
          price: number
          station_type: Database["public"]["Enums"]["station_type"]
          tier: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          minutes: number
          name: string
          org_id: string
          price: number
          station_type: Database["public"]["Enums"]["station_type"]
          tier?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          minutes?: number
          name?: string
          org_id?: string
          price?: number
          station_type?: Database["public"]["Enums"]["station_type"]
          tier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packages_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      pairing_codes: {
        Row: {
          code: string
          created_by: string | null
          expires_at: string
          org_id: string
          station_id: string
          used_at: string | null
        }
        Insert: {
          code: string
          created_by?: string | null
          expires_at?: string
          org_id: string
          station_id: string
          used_at?: string | null
        }
        Update: {
          code?: string
          created_by?: string | null
          expires_at?: string
          org_id?: string
          station_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pairing_codes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairing_codes_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          org_id: string
          received_by: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          id?: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          org_id: string
          received_by?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          org_id?: string
          received_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      pc_alerts: {
        Row: {
          away_from: string
          away_until: string
          branch_id: string
          created_at: string
          customer_name: string | null
          dismissed_at: string | null
          dismissed_by: string | null
          id: string
          kind: string
          org_id: string
          session_id: string | null
          station_id: string
        }
        Insert: {
          away_from: string
          away_until: string
          branch_id: string
          created_at?: string
          customer_name?: string | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          kind: string
          org_id: string
          session_id?: string | null
          station_id: string
        }
        Update: {
          away_from?: string
          away_until?: string
          branch_id?: string
          created_at?: string
          customer_name?: string | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          kind?: string
          org_id?: string
          session_id?: string | null
          station_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_alerts_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "pc_alerts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_alerts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_alerts_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          branch_id: string
          category: string
          cost: number | null
          created_at: string
          id: string
          is_active: boolean
          low_stock_at: number
          name: string
          options: Json
          org_id: string
          price: number
          stock: number | null
        }
        Insert: {
          barcode?: string | null
          branch_id: string
          category?: string
          cost?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          low_stock_at?: number
          name: string
          options?: Json
          org_id: string
          price: number
          stock?: number | null
        }
        Update: {
          barcode?: string | null
          branch_id?: string
          category?: string
          cost?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          low_stock_at?: number
          name?: string
          options?: Json
          org_id?: string
          price?: number
          stock?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_plans: {
        Row: {
          branch_id: string
          created_at: string
          extra_player_per_hour: number
          gst_rate_override: number | null
          id: string
          included_players: number
          is_active: boolean
          min_minutes: number
          name: string
          org_id: string
          per_frame: number | null
          per_hour: number
          player_choices: Json
          rounding_minutes: number
          station_type: Database["public"]["Enums"]["station_type"]
          tier: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          extra_player_per_hour?: number
          gst_rate_override?: number | null
          id?: string
          included_players?: number
          is_active?: boolean
          min_minutes?: number
          name: string
          org_id: string
          per_frame?: number | null
          per_hour: number
          player_choices?: Json
          rounding_minutes?: number
          station_type: Database["public"]["Enums"]["station_type"]
          tier?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          extra_player_per_hour?: number
          gst_rate_override?: number | null
          id?: string
          included_players?: number
          is_active?: boolean
          min_minutes?: number
          name?: string
          org_id?: string
          per_frame?: number | null
          per_hour?: number
          player_choices?: Json
          rounding_minutes?: number
          station_type?: Database["public"]["Enums"]["station_type"]
          tier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_plans_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      rate_rules: {
        Row: {
          created_at: string
          days_of_week: number[]
          end_time: string
          id: string
          name: string
          org_id: string
          per_hour: number
          priority: number
          rate_plan_id: string
          start_time: string
        }
        Insert: {
          created_at?: string
          days_of_week?: number[]
          end_time: string
          id?: string
          name: string
          org_id: string
          per_hour: number
          priority?: number
          rate_plan_id: string
          start_time: string
        }
        Update: {
          created_at?: string
          days_of_week?: number[]
          end_time?: string
          id?: string
          name?: string
          org_id?: string
          per_hour?: number
          priority?: number
          rate_plan_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_rules_rate_plan_id_org_id_fkey"
            columns: ["rate_plan_id", "org_id"]
            isOneToOne: false
            referencedRelation: "rate_plans"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      session_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          id: number
          kind: string
          org_id: string
          session_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          kind: string
          org_id: string
          session_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          kind?: string
          org_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_items: {
        Row: {
          created_at: string
          id: string
          invoice_id: string | null
          name: string
          org_id: string
          price: number
          product_id: string | null
          quantity: number
          session_id: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          name: string
          org_id: string
          price: number
          product_id?: string | null
          quantity?: number
          session_id: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          name?: string
          org_id?: string
          price?: number
          product_id?: string | null
          quantity?: number
          session_id?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "session_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_pauses: {
        Row: {
          ended_at: string | null
          id: string
          org_id: string
          session_id: string
          started_at: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          org_id: string
          session_id: string
          started_at?: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          org_id?: string
          session_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_pauses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          billed_amount: number
          branch_id: string
          charge_amount: number | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          ended_at: string | null
          ended_by: string | null
          frames: number
          id: string
          mode: Database["public"]["Enums"]["session_mode"]
          org_id: string
          outstanding: number | null
          paused_at: string | null
          planned_end_at: string | null
          players: number
          prepaid_amount: number
          prepaid_minutes: number
          rate_plan_id: string
          started_at: string
          started_by: string | null
          station_id: string
          status: Database["public"]["Enums"]["session_status"]
          write_off_reason: string | null
          written_off: boolean
        }
        Insert: {
          billed_amount?: number
          branch_id: string
          charge_amount?: number | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          ended_at?: string | null
          ended_by?: string | null
          frames?: number
          id?: string
          mode: Database["public"]["Enums"]["session_mode"]
          org_id: string
          outstanding?: number | null
          paused_at?: string | null
          planned_end_at?: string | null
          players?: number
          prepaid_amount?: number
          prepaid_minutes?: number
          rate_plan_id: string
          started_at?: string
          started_by?: string | null
          station_id: string
          status?: Database["public"]["Enums"]["session_status"]
          write_off_reason?: string | null
          written_off?: boolean
        }
        Update: {
          billed_amount?: number
          branch_id?: string
          charge_amount?: number | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          ended_at?: string | null
          ended_by?: string | null
          frames?: number
          id?: string
          mode?: Database["public"]["Enums"]["session_mode"]
          org_id?: string
          outstanding?: number | null
          paused_at?: string | null
          planned_end_at?: string | null
          players?: number
          prepaid_amount?: number
          prepaid_minutes?: number
          rate_plan_id?: string
          started_at?: string
          started_by?: string | null
          station_id?: string
          status?: Database["public"]["Enums"]["session_status"]
          write_off_reason?: string | null
          written_off?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sessions_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_rate_plan_id_org_id_fkey"
            columns: ["rate_plan_id", "org_id"]
            isOneToOne: false
            referencedRelation: "rate_plans"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "sessions_station_id_org_id_fkey"
            columns: ["station_id", "org_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      shift_closes: {
        Row: {
          branch_id: string
          cash_sales: number
          cash_wallet: number
          closed_at: string
          closed_by: string | null
          counted_cash: number
          difference: number
          expected_cash: number
          float_left: number
          id: string
          note: string | null
          opened_at: string
          opening_float: number
          org_id: string
          upi_total: number
        }
        Insert: {
          branch_id: string
          cash_sales?: number
          cash_wallet?: number
          closed_at?: string
          closed_by?: string | null
          counted_cash: number
          difference: number
          expected_cash: number
          float_left?: number
          id?: string
          note?: string | null
          opened_at: string
          opening_float?: number
          org_id: string
          upi_total?: number
        }
        Update: {
          branch_id?: string
          cash_sales?: number
          cash_wallet?: number
          closed_at?: string
          closed_by?: string | null
          counted_cash?: number
          difference?: number
          expected_cash?: number
          float_left?: number
          id?: string
          note?: string | null
          opened_at?: string
          opening_float?: number
          org_id?: string
          upi_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "shift_closes_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "shift_closes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      station_commands: {
        Row: {
          created_at: string
          created_by: string | null
          delivered_at: string | null
          done_at: string | null
          id: string
          kind: string
          org_id: string
          payload: Json
          result: string | null
          station_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          done_at?: string | null
          id?: string
          kind: string
          org_id: string
          payload?: Json
          result?: string | null
          station_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          done_at?: string | null
          id?: string
          kind?: string
          org_id?: string
          payload?: Json
          result?: string | null
          station_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "station_commands_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "station_commands_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      station_requests: {
        Row: {
          branch_id: string
          created_at: string
          handled_at: string | null
          handled_by: string | null
          id: string
          kind: string
          label: string
          minutes: number | null
          org_id: string
          product_id: string | null
          quantity: number | null
          session_id: string
          station_id: string
          status: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind: string
          label: string
          minutes?: number | null
          org_id: string
          product_id?: string | null
          quantity?: number | null
          session_id: string
          station_id: string
          status?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: string
          label?: string
          minutes?: number | null
          org_id?: string
          product_id?: string | null
          quantity?: number | null
          session_id?: string
          station_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "station_requests_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "station_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "station_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "station_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "station_requests_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      stations: {
        Row: {
          branch_id: string
          created_at: string
          hw_config: Json
          id: string
          layout_rot: number
          layout_x: number | null
          layout_y: number | null
          name: string
          org_id: string
          public_code: string
          sort_order: number
          status: Database["public"]["Enums"]["station_status"]
          tier: string
          type: Database["public"]["Enums"]["station_type"]
          updated_at: string
          zone: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          hw_config?: Json
          id?: string
          layout_rot?: number
          layout_x?: number | null
          layout_y?: number | null
          name: string
          org_id: string
          public_code?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["station_status"]
          tier?: string
          type: Database["public"]["Enums"]["station_type"]
          updated_at?: string
          zone?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          hw_config?: Json
          id?: string
          layout_rot?: number
          layout_x?: number | null
          layout_y?: number | null
          name?: string
          org_id?: string
          public_code?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["station_status"]
          tier?: string
          type?: Database["public"]["Enums"]["station_type"]
          updated_at?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stations_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      stock_moves: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          invoice_id: string | null
          note: string | null
          org_id: string
          product_id: string
          reason: string
          session_id: string | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          invoice_id?: string | null
          note?: string | null
          org_id: string
          product_id: string
          reason: string
          session_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          invoice_id?: string | null
          note?: string | null
          org_id?: string
          product_id?: string
          reason?: string
          session_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_moves_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invites: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_matches: {
        Row: {
          decided_at: string | null
          id: string
          org_id: string
          player1_id: string | null
          player2_id: string | null
          round: number
          score: string | null
          slot: number
          station_id: string | null
          station_ids: string[]
          tournament_id: string
          winner_id: string | null
        }
        Insert: {
          decided_at?: string | null
          id?: string
          org_id: string
          player1_id?: string | null
          player2_id?: string | null
          round: number
          score?: string | null
          slot: number
          station_id?: string | null
          station_ids?: string[]
          tournament_id: string
          winner_id?: string | null
        }
        Update: {
          decided_at?: string | null
          id?: string
          org_id?: string
          player1_id?: string | null
          player2_id?: string | null
          round?: number
          score?: string | null
          slot?: number
          station_id?: string | null
          station_ids?: string[]
          tournament_id?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_matches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_player1_id_fkey"
            columns: ["player1_id"]
            isOneToOne: false
            referencedRelation: "tournament_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_player2_id_fkey"
            columns: ["player2_id"]
            isOneToOne: false
            referencedRelation: "tournament_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "tournament_players"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_players: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          invoice_id: string | null
          members: string[]
          name: string
          org_id: string
          phone: string
          team_name: string | null
          tournament_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          invoice_id?: string | null
          members?: string[]
          name: string
          org_id: string
          phone: string
          team_name?: string | null
          tournament_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          invoice_id?: string | null
          members?: string[]
          name?: string
          org_id?: string
          phone?: string
          team_name?: string | null
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_players_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_players_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_players_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_players_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          entry_fee: number
          game: string
          id: string
          name: string
          org_id: string
          prize: string | null
          starts_at: string | null
          station_type: Database["public"]["Enums"]["station_type"] | null
          status: string
          team_size: number
          winner_id: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          entry_fee?: number
          game: string
          id?: string
          name: string
          org_id: string
          prize?: string | null
          starts_at?: string | null
          station_type?: Database["public"]["Enums"]["station_type"] | null
          status?: string
          team_size?: number
          winner_id?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          entry_fee?: number
          game?: string
          id?: string
          name?: string
          org_id?: string
          prize?: string | null
          starts_at?: string | null
          station_type?: Database["public"]["Enums"]["station_type"] | null
          status?: string
          team_size?: number
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_branch_id_org_id_fkey"
            columns: ["branch_id", "org_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "tournaments_winner_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "tournament_players"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          amount: number
          code: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          expires_on: string | null
          id: string
          note: string | null
          org_id: string
          redeemed_at: string | null
          redeemed_branch_id: string | null
          redeemed_by: string | null
          voided_at: string | null
        }
        Insert: {
          amount: number
          code: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          expires_on?: string | null
          id?: string
          note?: string | null
          org_id: string
          redeemed_at?: string | null
          redeemed_branch_id?: string | null
          redeemed_by?: string | null
          voided_at?: string | null
        }
        Update: {
          amount?: number
          code?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          expires_on?: string | null
          id?: string
          note?: string | null
          org_id?: string
          redeemed_at?: string | null
          redeemed_branch_id?: string | null
          redeemed_by?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_redeemed_branch_id_fkey"
            columns: ["redeemed_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          invoice_id: string | null
          method: string
          note: string | null
          org_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          invoice_id?: string | null
          method: string
          note?: string | null
          org_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          invoice_id?: string | null
          method?: string
          note?: string | null
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: { Args: { p_code: string }; Returns: string }
      add_session_item: {
        Args: {
          p_addons?: string[]
          p_name: string
          p_price: number
          p_product_id?: string
          p_quantity?: number
          p_session_id: string
          p_size?: string
        }
        Returns: string
      }
      add_session_items: {
        Args: { p_items: Json; p_session_id: string }
        Returns: undefined
      }
      add_tournament_player: {
        Args: {
          p_members?: string[]
          p_name?: string
          p_phone: string
          p_team_name?: string
          p_tournament_id: string
        }
        Returns: string
      }
      adjust_stock: {
        Args: {
          p_mode: string
          p_note?: string
          p_product_id: string
          p_qty: number
          p_reason?: string
          p_unit_cost?: number
        }
        Returns: number
      }
      agent_ack: {
        Args: { p_command_id: string; p_result?: string; p_token: string }
        Returns: undefined
      }
      agent_check_staff_pin: {
        Args: { p_pin: string; p_token: string }
        Returns: Json
      }
      agent_pair: { Args: { p_code: string; p_info?: Json }; Returns: Json }
      agent_player_login: {
        Args: { p_mobile: string; p_pin: string; p_token: string }
        Returns: Json
      }
      agent_redeem_voucher: {
        Args: { p_code: string; p_token: string }
        Returns: Json
      }
      agent_report: {
        Args: { p_details?: Json; p_kind: string; p_token: string }
        Returns: undefined
      }
      agent_request: {
        Args: {
          p_kind: string
          p_product_id?: string
          p_quantity?: number
          p_token: string
        }
        Returns: string
      }
      agent_set_staff_pin: {
        Args: { p_pin: string; p_token: string }
        Returns: undefined
      }
      agent_sync: { Args: { p_info?: Json; p_token: string }; Returns: Json }
      bulk_create_stations: {
        Args: {
          p_branch_id: string
          p_count: number
          p_prefix: string
          p_start?: number
          p_tier?: string
          p_type: Database["public"]["Enums"]["station_type"]
          p_zone?: string
        }
        Returns: {
          branch_id: string
          created_at: string
          hw_config: Json
          id: string
          layout_rot: number
          layout_x: number | null
          layout_y: number | null
          name: string
          org_id: string
          public_code: string
          sort_order: number
          status: Database["public"]["Enums"]["station_status"]
          tier: string
          type: Database["public"]["Enums"]["station_type"]
          updated_at: string
          zone: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "stations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      change_session_frames: {
        Args: { p_delta: number; p_session_id: string }
        Returns: number
      }
      checkout: {
        Args: {
          p_customer_name?: string
          p_customer_phone?: string
          p_discount?: number
          p_discount_reason?: string
          p_payments?: Json
          p_session_ids: string[]
        }
        Returns: string
      }
      clear_player_pin: { Args: { p_customer_id: string }; Returns: undefined }
      close_shift: {
        Args: {
          p_branch_id: string
          p_counted: number
          p_float_left?: number
          p_note?: string
        }
        Returns: string
      }
      create_branch: {
        Args: { p_name: string; p_org_id: string; p_timezone?: string }
        Returns: string
      }
      create_customer: {
        Args: { p_name: string; p_org_id: string; p_phone: string }
        Returns: string
      }
      create_invite: {
        Args: {
          p_org_id: string
          p_role: Database["public"]["Enums"]["member_role"]
        }
        Returns: string
      }
      create_organization: {
        Args: {
          p_branch_name: string
          p_org_name: string
          p_station_types?: Database["public"]["Enums"]["station_type"][]
          p_timezone?: string
        }
        Returns: string
      }
      create_pairing_code: { Args: { p_station_id: string }; Returns: string }
      create_tournament: {
        Args: {
          p_branch_id: string
          p_entry_fee?: number
          p_game: string
          p_name: string
          p_prize?: string
          p_starts_at?: string
          p_station_type?: Database["public"]["Enums"]["station_type"]
          p_team_size?: number
        }
        Returns: string
      }
      create_vouchers: {
        Args: {
          p_amount: number
          p_count: number
          p_expires_on?: string
          p_note?: string
          p_org_id: string
        }
        Returns: string[]
      }
      deduct_wallet: {
        Args: {
          p_amount: number
          p_branch_id?: string
          p_customer_id: string
          p_method?: string
          p_note?: string
        }
        Returns: number
      }
      delete_tournament: {
        Args: { p_tournament_id: string }
        Returns: undefined
      }
      dismiss_pc_alert: { Args: { p_alert_id: string }; Returns: undefined }
      end_session: { Args: { p_session_id: string }; Returns: Json }
      extend_session: {
        Args: {
          p_minutes?: number
          p_package_id?: string
          p_payments?: Json
          p_session_id: string
        }
        Returns: undefined
      }
      handle_station_request: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: undefined
      }
      list_customers: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_org_id: string
          p_search?: string
        }
        Returns: {
          created_at: string
          id: string
          last_visit: string
          name: string
          phone: string
          total_count: number
          total_spent: number
          visits: number
        }[]
      }
      pause_session: { Args: { p_session_id: string }; Returns: undefined }
      pay_tournament_entry: {
        Args: { p_payments?: Json; p_player_id: string }
        Returns: string
      }
      player_summary: { Args: { p_customer_id: string }; Returns: Json }
      product_costs: {
        Args: { p_branch_id: string }
        Returns: {
          cost: number
          product_id: string
        }[]
      }
      public_booking_info: { Args: { p_slug: string }; Returns: Json }
      public_booking_slots: {
        Args: {
          p_date: string
          p_minutes: number
          p_slug: string
          p_type: Database["public"]["Enums"]["station_type"]
        }
        Returns: Json
      }
      public_create_booking: {
        Args: {
          p_minutes: number
          p_name: string
          p_note?: string
          p_phone: string
          p_players: number
          p_slug: string
          p_starts_at: string
          p_type: Database["public"]["Enums"]["station_type"]
        }
        Returns: string
      }
      public_station: { Args: { p_code: string }; Returns: Json }
      public_station_request: {
        Args: {
          p_code: string
          p_kind: string
          p_product_id?: string
          p_quantity?: number
        }
        Returns: string
      }
      quick_sale: {
        Args: {
          p_branch_id: string
          p_customer_name?: string
          p_customer_phone?: string
          p_discount?: number
          p_discount_reason?: string
          p_items: Json
          p_payments?: Json
        }
        Returns: string
      }
      redeem_voucher: {
        Args: { p_branch_id?: string; p_code: string; p_customer_id: string }
        Returns: Json
      }
      reduce_session_item: {
        Args: { p_item_id: string; p_quantity?: number }
        Returns: undefined
      }
      remove_session_item: { Args: { p_item_id: string }; Returns: undefined }
      remove_tournament_player: {
        Args: { p_player_id: string }
        Returns: undefined
      }
      report_insights: {
        Args: { p_branch_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      report_snacks: {
        Args: { p_branch_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      report_summary: {
        Args: { p_branch_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      reset_station_code: { Args: { p_station_id: string }; Returns: string }
      resume_session: { Args: { p_session_id: string }; Returns: undefined }
      save_booking: {
        Args: {
          p_booking_id: string
          p_branch_id: string
          p_minutes: number
          p_name?: string
          p_note?: string
          p_phone: string
          p_players: number
          p_starts_at: string
          p_station_id?: string
          p_type: Database["public"]["Enums"]["station_type"]
        }
        Returns: string
      }
      save_station_layout: {
        Args: { p_branch_id: string; p_layout: Json }
        Returns: undefined
      }
      send_station_command: {
        Args: { p_kind: string; p_payload?: Json; p_station_id: string }
        Returns: string
      }
      server_time: { Args: never; Returns: string }
      set_booking_status: {
        Args: { p_booking_id: string; p_station_id?: string; p_status: string }
        Returns: undefined
      }
      set_match_station: {
        Args: { p_match_id: string; p_station_id: string }
        Returns: undefined
      }
      set_match_stations: {
        Args: { p_match_id: string; p_station_ids: string[] }
        Returns: undefined
      }
      set_match_winner: {
        Args: { p_match_id: string; p_score?: string; p_winner_id: string }
        Returns: undefined
      }
      set_player_credit_limit: {
        Args: { p_customer_id: string; p_limit: number }
        Returns: undefined
      }
      set_player_pin: {
        Args: { p_customer_id: string; p_pin: string }
        Returns: undefined
      }
      set_product_cost: {
        Args: { p_cost: number; p_product_id: string }
        Returns: undefined
      }
      set_session_payer: {
        Args: { p_name?: string; p_phone: string; p_session_ids: string[] }
        Returns: string
      }
      set_session_players: {
        Args: { p_players: number; p_session_id: string }
        Returns: undefined
      }
      shift_status: { Args: { p_branch_id: string }; Returns: Json }
      start_session: {
        Args: {
          p_minutes?: number
          p_mode: Database["public"]["Enums"]["session_mode"]
          p_name?: string
          p_package_id?: string
          p_payments?: Json
          p_phone: string
          p_players?: number
          p_station_id: string
        }
        Returns: string
      }
      start_tournament: {
        Args: { p_tournament_id: string }
        Returns: undefined
      }
      stations_per_match: {
        Args: {
          p_team_size: number
          p_type: Database["public"]["Enums"]["station_type"]
        }
        Returns: number
      }
      stock_history: {
        Args: {
          p_branch_id: string
          p_limit?: number
          p_product_id?: string
          p_reasons?: string[]
        }
        Returns: {
          created_at: string
          created_by: string
          delta: number
          id: string
          invoice_id: string
          note: string
          product_id: string
          product_name: string
          reason: string
          value: number
        }[]
      }
      submit_contact_message: {
        Args: {
          p_email: string
          p_message: string
          p_name: string
          p_phone: string
          p_sender_hash?: string
          p_topic: string
          p_venue: string
        }
        Returns: undefined
      }
      top_products: {
        Args: { p_branch_id: string; p_days?: number; p_limit?: number }
        Returns: {
          product_id: string
          qty: number
        }[]
      }
      topup_wallet: {
        Args: {
          p_amount: number
          p_bonus?: number
          p_branch_id?: string
          p_customer_id: string
          p_method?: string
          p_note?: string
        }
        Returns: number
      }
      transfer_session: {
        Args: { p_session_id: string; p_to_station_id: string }
        Returns: undefined
      }
      unpair_device: { Args: { p_station_id: string }; Returns: undefined }
      update_all_pcs: { Args: { p_branch_id: string }; Returns: number }
      void_invoice: {
        Args: { p_invoice_id: string; p_reason: string; p_restock?: boolean }
        Returns: Json
      }
      void_voucher: { Args: { p_voucher_id: string }; Returns: undefined }
      write_off_session: {
        Args: { p_reason: string; p_session_id: string }
        Returns: undefined
      }
    }
    Enums: {
      expense_category:
        | "salary"
        | "rent"
        | "electricity"
        | "internet"
        | "maintenance"
        | "supplies"
        | "marketing"
        | "other"
      leftover_policy: "keep_days" | "same_day" | "forfeit"
      member_role: "owner" | "manager" | "staff"
      payment_method: "cash" | "upi" | "card" | "wallet"
      session_mode: "open" | "prepaid" | "frames"
      session_status: "running" | "paused" | "ended"
      station_status: "active" | "maintenance" | "disabled"
      station_type: "pc" | "ps5" | "xbox" | "snooker" | "pool" | "other"
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
      expense_category: [
        "salary",
        "rent",
        "electricity",
        "internet",
        "maintenance",
        "supplies",
        "marketing",
        "other",
      ],
      leftover_policy: ["keep_days", "same_day", "forfeit"],
      member_role: ["owner", "manager", "staff"],
      payment_method: ["cash", "upi", "card", "wallet"],
      session_mode: ["open", "prepaid", "frames"],
      session_status: ["running", "paused", "ended"],
      station_status: ["active", "maintenance", "disabled"],
      station_type: ["pc", "ps5", "xbox", "snooker", "pool", "other"],
    },
  },
} as const
