// Hand-written to match supabase/migrations. Regenerate with (Git Bash):
//   npx supabase gen types typescript --project-id <project-ref> --schema public > src/lib/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Ts = string;

type Rel<Name extends string, Cols extends string[], Ref extends string, RefCols extends string[]> = {
  foreignKeyName: Name;
  columns: Cols;
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: RefCols;
};

// Writes to most tables go through RPCs, so Insert/Update are kept loose.
type Table<Row, Relationships extends unknown[] = []> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: Relationships;
};

type E = Database["public"]["Enums"];

export type Database = {
  public: {
    Tables: {
      profiles: Table<{ id: string; full_name: string; phone: string | null; created_at: Ts; updated_at: Ts }>;
      orgs: Table<{
        id: string;
        name: string;
        created_by: string | null;
        /** Wallet top-up offers: [{ pay, bonus }] */
        wallet_offers: Json;
        /** % of each cash/UPI bill credited back to the player's wallet (0–20). */
        spend_bonus_pct: number;
        created_at: Ts;
        updated_at: Ts;
      }>;
      memberships: Table<
        { org_id: string; user_id: string; role: E["member_role"]; created_at: Ts },
        [Rel<"memberships_org_id_fkey", ["org_id"], "orgs", ["id"]>]
      >;
      branches: Table<{
        id: string;
        org_id: string;
        name: string;
        address: string | null;
        phone: string | null;
        timezone: string;
        opening_time: string | null;
        closing_time: string | null;
        created_at: Ts;
        updated_at: Ts;
      }, [Rel<"branches_org_id_fkey", ["org_id"], "orgs", ["id"]>]>;
      branch_settings: Table<{
        branch_id: string;
        org_id: string;
        gst_enabled: boolean;
        gstin: string | null;
        gst_rate: number;
        prices_include_tax: boolean;
        invoice_prefix: string;
        default_mode_by_type: Json;
        allowed_modes_by_type: Json;
        leftover_policy: E["leftover_policy"];
        leftover_keep_days: number;
        upi_vpa: string | null;
        upi_payee_name: string | null;
        overtime_grace_minutes: number;
        staff_max_discount_pct: number;
        early_end_policy: "full" | "played";
        station_types: E["station_type"][];
        blocked_apps: string[];
        lock_message: string | null;
        pc_player_login: boolean;
        /** Games menu on the PCs: [{ id, name, target }] */
        pc_games: Json;
        pc_restrictions: ("task_manager" | "control_panel" | "command_line" | "usb_drives")[];
        /** Most a player may owe (khata). null = no limit. */
        credit_limit: number | null;
        /** Player QR page on each station. */
        qr_enabled: boolean;
        qr_orders: boolean;
        /** Public booking page at /book/<booking_slug>. */
        booking_enabled: boolean;
        booking_slug: string | null;
        booking_days: number;
        booking_note: string | null;
        updated_at: Ts;
      }>;
      stations: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        type: E["station_type"];
        name: string;
        zone: string | null;
        tier: string;
        status: E["station_status"];
        sort_order: number;
        hw_config: Json;
        layout_x: number | null;
        layout_y: number | null;
        layout_rot: number;
        /** The code in the station's player QR (/s/<code>). */
        public_code: string;
        created_at: Ts;
        updated_at: Ts;
      }>;
      rate_plans: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        name: string;
        station_type: E["station_type"];
        tier: string | null;
        per_hour: number;
        min_minutes: number;
        rounding_minutes: number;
        included_players: number;
        extra_player_per_hour: number;
        /** [] = one price for any number of players; else [{ players, per_hour, per_frame? }]. */
        player_choices: Json;
        /** Price per frame; null = this rate can't bill by frame. */
        per_frame: number | null;
        gst_rate_override: number | null;
        is_active: boolean;
        created_at: Ts;
        updated_at: Ts;
      }>;
      rate_rules: Table<
        {
          id: string;
          org_id: string;
          rate_plan_id: string;
          name: string;
          days_of_week: number[];
          start_time: string;
          end_time: string;
          per_hour: number;
          priority: number;
          created_at: Ts;
        },
        [Rel<"rate_rules_rate_plan_id_org_id_fkey", ["rate_plan_id", "org_id"], "rate_plans", ["id", "org_id"]>]
      >;
      packages: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        name: string;
        station_type: E["station_type"];
        tier: string | null;
        minutes: number;
        price: number;
        is_active: boolean;
        created_at: Ts;
        updated_at: Ts;
      }>;
      audit_log: Table<{
        id: number;
        org_id: string;
        actor_id: string | null;
        action: string;
        entity: string;
        entity_id: string | null;
        details: Json;
        created_at: Ts;
      }>;
      pc_alerts: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        station_id: string;
        session_id: string | null;
        kind: "app_closed" | "pc_restarted" | "offline";
        away_from: Ts;
        away_until: Ts;
        customer_name: string | null;
        dismissed_by: string | null;
        dismissed_at: Ts | null;
        created_at: Ts;
      }>;
      vouchers: Table<
        {
          id: string;
          org_id: string;
          code: string;
          amount: number;
          note: string | null;
          expires_on: string | null;
          created_by: string | null;
          created_at: Ts;
          redeemed_at: Ts | null;
          redeemed_by: string | null;
          redeemed_branch_id: string | null;
          customer_id: string | null;
          voided_at: Ts | null;
        },
        [Rel<"vouchers_customer_id_fkey", ["customer_id"], "customers", ["id"]>]
      >;
      shift_closes: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        closed_by: string | null;
        opened_at: Ts;
        closed_at: Ts;
        opening_float: number;
        cash_sales: number;
        cash_wallet: number;
        upi_total: number;
        expected_cash: number;
        counted_cash: number;
        difference: number;
        float_left: number;
        note: string | null;
      }>;
      expenses: Table<
        {
          id: string;
          org_id: string;
          branch_id: string;
          category: E["expense_category"];
          name: string;
          amount: number;
          spent_on: string;
          staff_id: string | null;
          note: string | null;
          repeats_monthly: boolean;
          created_by: string | null;
          created_at: Ts;
          updated_at: Ts;
        },
        [Rel<"expenses_branch_id_org_id_fkey", ["branch_id", "org_id"], "branches", ["id", "org_id"]>]
      >;
      customers: Table<{
        id: string;
        org_id: string;
        phone: string;
        name: string;
        wallet_balance: number;
        /** Read-only: true when the player has a PC login PIN (the hash itself is never readable). */
        pin_set: boolean;
        /** This player's khata limit; null = the venue's. */
        credit_limit: number | null;
        created_by: string | null;
        created_at: Ts;
        updated_at: Ts;
      }>;
      products: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        name: string;
        category: "beverage" | "snack" | "food" | "accessory" | "other";
        price: number;
        is_active: boolean;
        /** null = stock not tracked */
        stock: number | null;
        low_stock_at: number;
        created_at: Ts;
      }>;
      stock_moves: Table<{
        id: string;
        org_id: string;
        product_id: string;
        delta: number;
        reason: "sale" | "return" | "receive" | "count" | "void" | "start";
        invoice_id: string | null;
        session_id: string | null;
        note: string | null;
        created_by: string | null;
        created_at: Ts;
      }>;
      session_items: Table<{
        id: string;
        org_id: string;
        session_id: string;
        product_id: string | null;
        name: string;
        price: number;
        quantity: number;
        invoice_id: string | null;
        created_at: Ts;
      }>;
      wallet_transactions: Table<{
        id: string;
        org_id: string;
        branch_id: string | null;
        customer_id: string;
        amount: number;
        balance_after: number;
        method: "cash" | "upi" | "bonus" | "gameplay" | "void";
        note: string | null;
        invoice_id: string | null;
        created_by: string | null;
        created_at: Ts;
      }>;
      sessions: Table<
        {
          id: string;
          org_id: string;
          branch_id: string;
          station_id: string;
          rate_plan_id: string;
          mode: E["session_mode"];
          status: E["session_status"];
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          players: number;
          started_at: Ts;
          planned_end_at: Ts | null;
          prepaid_minutes: number;
          prepaid_amount: number;
          frames: number;
          paused_at: Ts | null;
          ended_at: Ts | null;
          charge_amount: number | null;
          billed_amount: number;
          outstanding: number;
          written_off: boolean;
          write_off_reason: string | null;
          started_by: string | null;
          ended_by: string | null;
          created_at: Ts;
        },
        [Rel<"sessions_station_id_org_id_fkey", ["station_id", "org_id"], "stations", ["id", "org_id"]>]
      >;
      session_pauses: Table<
        { id: string; org_id: string; session_id: string; started_at: Ts; ended_at: Ts | null },
        [Rel<"session_pauses_session_id_fkey", ["session_id"], "sessions", ["id"]>]
      >;
      session_events: Table<
        {
          id: number;
          org_id: string;
          session_id: string;
          kind: string;
          actor_id: string | null;
          details: Json;
          created_at: Ts;
        },
        [Rel<"session_events_session_id_fkey", ["session_id"], "sessions", ["id"]>]
      >;
      invoices: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        number: string;
        gst_enabled: boolean;
        gstin: string | null;
        prices_include_tax: boolean;
        customer_name: string | null;
        customer_phone: string | null;
        subtotal: number;
        discount: number;
        discount_reason: string | null;
        taxable_amount: number;
        cgst: number;
        sgst: number;
        total: number;
        voided_at: Ts | null;
        voided_by: string | null;
        void_reason: string | null;
        created_by: string | null;
        created_at: Ts;
      }>;
      invoice_lines: Table<
        {
          id: string;
          org_id: string;
          invoice_id: string;
          session_id: string | null;
          description: string;
          minutes: number | null;
          amount: number;
          gst_rate: number;
          product_id: string | null;
          quantity: number | null;
        },
        [Rel<"invoice_lines_invoice_id_fkey", ["invoice_id"], "invoices", ["id"]>]
      >;
      payments: Table<
        {
          id: string;
          org_id: string;
          branch_id: string;
          invoice_id: string;
          method: E["payment_method"];
          amount: number;
          reference: string | null;
          received_by: string | null;
          created_at: Ts;
        },
        [Rel<"payments_invoice_id_fkey", ["invoice_id"], "invoices", ["id"]>]
      >;
      devices: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        station_id: string;
        hostname: string | null;
        agent_version: string | null;
        os: string | null;
        ip: string | null;
        mac: string | null;
        screen_locked: boolean | null;
        last_seen_at: Ts | null;
        created_at: Ts;
        /** Readings from the PC's last check-in (see DeviceHealth in lib/devices). */
        health: Json | null;
        health_at: Ts | null;
      }>;
      station_commands: Table<{
        id: string;
        org_id: string;
        station_id: string;
        kind: "message" | "restart" | "shutdown" | "wake";
        payload: Json;
        created_by: string | null;
        created_at: Ts;
        delivered_at: Ts | null;
        done_at: Ts | null;
        result: string | null;
      }>;
      station_requests: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        station_id: string;
        session_id: string;
        kind: "snack" | "extend" | "call";
        product_id: string | null;
        label: string;
        quantity: number | null;
        minutes: number | null;
        status: "pending" | "accepted" | "declined";
        handled_by: string | null;
        handled_at: Ts | null;
        created_at: Ts;
      }>;
      bookings: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        station_type: E["station_type"];
        station_id: string | null;
        customer_id: string | null;
        name: string;
        phone: string;
        starts_at: Ts;
        minutes: number;
        players: number;
        note: string | null;
        status: "requested" | "confirmed" | "arrived" | "cancelled" | "no_show";
        source: "online" | "staff";
        created_by: string | null;
        handled_by: string | null;
        created_at: Ts;
        updated_at: Ts;
      }>;
      tournaments: Table<{
        id: string;
        org_id: string;
        branch_id: string;
        name: string;
        game: string;
        entry_fee: number;
        prize: string | null;
        starts_at: Ts | null;
        status: "open" | "running" | "finished";
        winner_id: string | null;
        created_by: string | null;
        created_at: Ts;
        /** 1 = singles; more = teams of this size (captain + others). */
        team_size: number;
        /** Which stations matches are played on; null = not linked. */
        station_type: E["station_type"] | null;
      }>;
      tournament_players: Table<
        {
          id: string;
          org_id: string;
          tournament_id: string;
          customer_id: string;
          name: string;
          phone: string;
          invoice_id: string | null;
          created_at: Ts;
          /** Team entries: the team's name. name / phone are the captain's. */
          team_name: string | null;
          members: string[];
        },
        [Rel<"tournament_players_invoice_id_fkey", ["invoice_id"], "invoices", ["id"]>]
      >;
      tournament_matches: Table<{
        id: string;
        org_id: string;
        tournament_id: string;
        round: number;
        slot: number;
        player1_id: string | null;
        player2_id: string | null;
        winner_id: string | null;
        decided_at: Ts | null;
        station_id: string | null;
      }>;
      team_invites: Table<{
        id: string;
        org_id: string;
        code: string;
        role: E["member_role"];
        created_by: string | null;
        created_at: Ts;
        expires_at: Ts;
        used_by: string | null;
        used_at: Ts | null;
      }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_organization: {
        Args: {
          p_org_name: string;
          p_branch_name: string;
          p_timezone?: string;
          p_station_types?: E["station_type"][];
        };
        Returns: string;
      };
      create_branch: { Args: { p_org_id: string; p_name: string; p_timezone?: string }; Returns: string };
      bulk_create_stations: {
        Args: {
          p_branch_id: string;
          p_type: E["station_type"];
          p_prefix: string;
          p_count: number;
          p_start?: number;
          p_tier?: string;
          p_zone?: string;
        };
        Returns: Database["public"]["Tables"]["stations"]["Row"][];
      };
      server_time: { Args: Record<PropertyKey, never>; Returns: string };
      start_session: {
        Args: {
          p_station_id: string;
          p_mode: E["session_mode"];
          p_phone: string;
          p_name?: string;
          p_players?: number;
          p_package_id?: string;
          p_minutes?: number;
          p_payments?: Json;
        };
        Returns: string;
      };
      pause_session: { Args: { p_session_id: string }; Returns: undefined };
      resume_session: { Args: { p_session_id: string }; Returns: undefined };
      extend_session: {
        Args: { p_session_id: string; p_package_id?: string; p_minutes?: number; p_payments?: Json };
        Returns: undefined;
      };
      transfer_session: { Args: { p_session_id: string; p_to_station_id: string }; Returns: undefined };
      end_session: { Args: { p_session_id: string }; Returns: Json };
      checkout: {
        Args: {
          p_session_ids: string[];
          p_discount?: number;
          p_payments?: Json;
          p_customer_name?: string;
          p_customer_phone?: string;
          p_discount_reason?: string | null;
        };
        Returns: string;
      };
      quick_sale: {
        Args: {
          p_branch_id: string;
          p_items: Json;
          p_discount?: number;
          p_payments?: Json;
          p_customer_name?: string | null;
          p_customer_phone?: string | null;
          p_discount_reason?: string | null;
        };
        Returns: string;
      };
      create_pairing_code: { Args: { p_station_id: string }; Returns: string };
      unpair_device: { Args: { p_station_id: string }; Returns: undefined };
      send_station_command: {
        Args: { p_station_id: string; p_kind: "message" | "restart" | "shutdown" | "wake"; p_payload?: Json };
        Returns: string;
      };
      set_player_pin: { Args: { p_customer_id: string; p_pin: string }; Returns: undefined };
      clear_player_pin: { Args: { p_customer_id: string }; Returns: undefined };
      void_invoice: { Args: { p_invoice_id: string; p_reason: string; p_restock?: boolean }; Returns: Json };
      adjust_stock: {
        Args: { p_product_id: string; p_mode: "receive" | "count"; p_qty: number | null; p_note?: string | null };
        Returns: number | null;
      };
      write_off_session: { Args: { p_session_id: string; p_reason: string }; Returns: undefined };
      create_customer: { Args: { p_org_id: string; p_phone: string; p_name: string }; Returns: string };
      list_customers: {
        Args: { p_org_id: string; p_search?: string; p_limit?: number; p_offset?: number };
        Returns: {
          id: string;
          name: string;
          phone: string;
          created_at: string;
          visits: number;
          total_spent: number;
          last_visit: string | null;
          total_count: number;
        }[];
      };
      create_invite: { Args: { p_org_id: string; p_role: E["member_role"] }; Returns: string };
      accept_invite: { Args: { p_code: string }; Returns: string };
      report_summary: { Args: { p_branch_id: string; p_from: string; p_to: string }; Returns: Json };
      report_insights: { Args: { p_branch_id: string; p_from: string; p_to: string }; Returns: Json };
      save_station_layout: { Args: { p_branch_id: string; p_layout: Json }; Returns: undefined };
      player_summary: { Args: { p_customer_id: string }; Returns: Json };
      set_session_players: { Args: { p_session_id: string; p_players: number }; Returns: undefined };
      /** +1 / -1 frame on a frames session; returns the new count. */
      change_session_frames: { Args: { p_session_id: string; p_delta: number }; Returns: number };
      /** Who pays: moves unpaid (or live) sessions to another player. Returns their id. */
      set_session_payer: { Args: { p_session_ids: string[]; p_phone: string; p_name?: string | null }; Returns: string };
      set_player_credit_limit: { Args: { p_customer_id: string; p_limit: number | null }; Returns: undefined };
      public_station: { Args: { p_code: string }; Returns: Json };
      public_station_request: {
        Args: { p_code: string; p_kind: "snack" | "extend" | "call"; p_product_id?: string | null; p_quantity?: number };
        Returns: string;
      };
      handle_station_request: { Args: { p_request_id: string; p_accept: boolean }; Returns: undefined };
      dismiss_pc_alert: { Args: { p_alert_id: string }; Returns: undefined };
      create_vouchers: {
        Args: { p_org_id: string; p_count: number; p_amount: number; p_expires_on?: string | null; p_note?: string | null };
        Returns: string[];
      };
      void_voucher: { Args: { p_voucher_id: string }; Returns: undefined };
      redeem_voucher: { Args: { p_customer_id: string; p_code: string; p_branch_id?: string | null }; Returns: Json };
      shift_status: { Args: { p_branch_id: string }; Returns: Json };
      close_shift: {
        Args: { p_branch_id: string; p_counted: number; p_float_left?: number; p_note?: string | null };
        Returns: string;
      };
      reset_station_code: { Args: { p_station_id: string }; Returns: string };
      public_booking_info: { Args: { p_slug: string }; Returns: Json };
      public_booking_slots: {
        Args: { p_slug: string; p_type: E["station_type"]; p_date: string; p_minutes: number };
        Returns: Json;
      };
      public_create_booking: {
        Args: {
          p_slug: string;
          p_type: E["station_type"];
          p_starts_at: string;
          p_minutes: number;
          p_players: number;
          p_name: string;
          p_phone: string;
          p_note?: string | null;
        };
        Returns: string;
      };
      save_booking: {
        Args: {
          p_booking_id: string | null;
          p_branch_id: string;
          p_type: E["station_type"];
          p_starts_at: string;
          p_minutes: number;
          p_players: number;
          p_phone: string;
          p_name?: string | null;
          p_note?: string | null;
          p_station_id?: string | null;
        };
        Returns: string;
      };
      set_booking_status: {
        Args: {
          p_booking_id: string;
          p_status: "confirmed" | "arrived" | "cancelled" | "no_show";
          p_station_id?: string | null;
        };
        Returns: undefined;
      };
      create_tournament: {
        Args: {
          p_branch_id: string;
          p_name: string;
          p_game: string;
          p_entry_fee?: number;
          p_prize?: string | null;
          p_starts_at?: string | null;
          p_team_size?: number;
          p_station_type?: E["station_type"] | null;
        };
        Returns: string;
      };
      delete_tournament: { Args: { p_tournament_id: string }; Returns: undefined };
      add_tournament_player: {
        Args: {
          p_tournament_id: string;
          p_phone: string;
          p_name?: string | null;
          p_team_name?: string | null;
          p_members?: string[];
        };
        Returns: string;
      };
      /** p_station_id null clears it. */
      set_match_station: { Args: { p_match_id: string; p_station_id: string | null }; Returns: undefined };
      remove_tournament_player: { Args: { p_player_id: string }; Returns: undefined };
      pay_tournament_entry: { Args: { p_player_id: string; p_payments?: Json }; Returns: string };
      start_tournament: { Args: { p_tournament_id: string }; Returns: undefined };
      /** p_winner_id null undoes the result. */
      set_match_winner: { Args: { p_match_id: string; p_winner_id: string | null }; Returns: undefined };
      add_session_item: {
        Args: {
          p_session_id: string;
          p_name: string;
          p_price: number;
          p_quantity?: number;
          p_product_id?: string | null;
        };
        Returns: string;
      };
      remove_session_item: { Args: { p_item_id: string }; Returns: undefined };
      /** Take some off a line (default 1); down to zero removes it. */
      reduce_session_item: { Args: { p_item_id: string; p_quantity?: number }; Returns: undefined };
      /** Public contact form: stores a message for the QueSys team. */
      submit_contact_message: {
        Args: {
          p_name: string;
          p_email: string | null;
          p_phone: string | null;
          p_venue: string | null;
          p_topic: "setup" | "pricing" | "pc_app" | "support" | "other";
          p_message: string;
          p_sender_hash?: string | null;
        };
        Returns: undefined;
      };
      topup_wallet: {
        Args: {
          p_customer_id: string;
          p_amount: number;
          p_method?: string;
          p_note?: string | null;
          /** Owner only: a hand-picked bonus instead of the venue's offers. */
          p_bonus?: number | null;
          /** Branch whose counter took the money (for that branch's cash in drawer). */
          p_branch_id?: string | null;
        };
        Returns: number;
      };
      deduct_wallet: {
        Args: {
          p_customer_id: string;
          p_amount: number;
          p_note?: string | null;
          p_method?: "cash" | "upi";
          p_branch_id?: string | null;
        };
        Returns: number;
      };
    };
    Enums: {
      member_role: "owner" | "manager" | "staff";
      station_type: "pc" | "ps5" | "xbox" | "snooker" | "pool" | "other";
      station_status: "active" | "maintenance" | "disabled";
      session_mode: "open" | "prepaid" | "frames";
      session_status: "running" | "paused" | "ended";
      payment_method: "cash" | "upi" | "card" | "wallet";
      expense_category:
        | "salary"
        | "rent"
        | "electricity"
        | "internet"
        | "maintenance"
        | "supplies"
        | "marketing"
        | "other";
      leftover_policy: "keep_days" | "same_day" | "forfeit";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
