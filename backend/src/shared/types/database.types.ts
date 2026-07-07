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
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          failed_login_count: number
          full_name: string
          id: string
          is_active: boolean
          is_locked: boolean
          last_login_at: string | null
          last_login_ip: unknown
          lock_reason: string | null
          locked_until: string | null
          must_change_password: boolean
          phone: string | null
          role: Database["public"]["Enums"]["admin_role"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          failed_login_count?: number
          full_name: string
          id: string
          is_active?: boolean
          is_locked?: boolean
          last_login_at?: string | null
          last_login_ip?: unknown
          lock_reason?: string | null
          locked_until?: string | null
          must_change_password?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["admin_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          failed_login_count?: number
          full_name?: string
          id?: string
          is_active?: boolean
          is_locked?: boolean
          last_login_at?: string | null
          last_login_ip?: unknown
          lock_reason?: string | null
          locked_until?: string | null
          must_change_password?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["admin_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_admin_profiles_tenant"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assistance_requests: {
        Row: {
          created_at: string | null
          id: string
          message: string | null
          request_type: string
          status: string | null
          table_id: string | null
          table_num: string
          table_session_id: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          message?: string | null
          request_type: string
          status?: string | null
          table_id?: string | null
          table_num: string
          table_session_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string | null
          request_type?: string
          status?: string | null
          table_id?: string | null
          table_num?: string
          table_session_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistance_requests_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistance_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          branch_id: string | null
          correlation_id: string
          created_at: string
          id: string
          ip_address: string | null
          payload: Json
          tenant_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          branch_id?: string | null
          correlation_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          payload?: Json
          tenant_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          branch_id?: string | null
          correlation_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          payload?: Json
          tenant_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_audit_logs: {
        Row: {
          created_at: string
          device_fingerprint: string | null
          device_session_id: string | null
          event_type: Database["public"]["Enums"]["auth_event_type"]
          failure_reason: string | null
          id: string
          ip_address: unknown
          metadata: Json
          tenant_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          device_fingerprint?: string | null
          device_session_id?: string | null
          event_type: Database["public"]["Enums"]["auth_event_type"]
          failure_reason?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          device_fingerprint?: string | null
          device_session_id?: string | null
          event_type?: Database["public"]["Enums"]["auth_event_type"]
          failure_reason?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auth_audit_logs_device_session_id_fkey"
            columns: ["device_session_id"]
            isOneToOne: false
            referencedRelation: "device_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_rate_limits: {
        Row: {
          attempt_count: number
          blocked_until: string | null
          created_at: string
          id: string
          key: string
          updated_at: string
          window_start: string
        }
        Insert: {
          attempt_count?: number
          blocked_until?: string | null
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          attempt_count?: number
          blocked_until?: string | null
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      availability_schedules: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          day_of_week: number
          deleted_at: string | null
          end_time: string
          id: string
          is_active: boolean
          menu_item_id: string
          priority: number
          start_time: string
          tenant_id: string
          timezone: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          day_of_week: number
          deleted_at?: string | null
          end_time: string
          id?: string
          is_active?: boolean
          menu_item_id: string
          priority?: number
          start_time: string
          tenant_id: string
          timezone: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          day_of_week?: number
          deleted_at?: string | null
          end_time?: string
          id?: string
          is_active?: boolean
          menu_item_id?: string
          priority?: number
          start_time?: string
          tenant_id?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_avail_schedule_branch"
            columns: ["tenant_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_avail_schedule_menu_item"
            columns: ["tenant_id", "menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      bill_items: {
        Row: {
          bill_id: string
          created_at: string
          discount_total_minor: number
          grand_total_minor: number
          id: string
          order_item_snapshot_id: string
          quantity: number
          subtotal_minor: number
          tax_total_minor: number
          tenant_id: string
          unit_price_minor: number
        }
        Insert: {
          bill_id: string
          created_at?: string
          discount_total_minor?: number
          grand_total_minor: number
          id?: string
          order_item_snapshot_id: string
          quantity: number
          subtotal_minor: number
          tax_total_minor?: number
          tenant_id: string
          unit_price_minor: number
        }
        Update: {
          bill_id?: string
          created_at?: string
          discount_total_minor?: number
          grand_total_minor?: number
          id?: string
          order_item_snapshot_id?: string
          quantity?: number
          subtotal_minor?: number
          tax_total_minor?: number
          tenant_id?: string
          unit_price_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "bill_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_items_order_item_snapshot_id_fkey"
            columns: ["order_item_snapshot_id"]
            isOneToOne: false
            referencedRelation: "order_item_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_orders: {
        Row: {
          bill_id: string
          created_at: string
          id: string
          order_id: string
          tenant_id: string
        }
        Insert: {
          bill_id: string
          created_at?: string
          id?: string
          order_id: string
          tenant_id: string
        }
        Update: {
          bill_id?: string
          created_at?: string
          id?: string
          order_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_orders_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_payments: {
        Row: {
          amount_minor: number
          branch_id: string
          completed_at: string | null
          created_at: string
          currency_code: string
          failed_at: string | null
          failure_reason: string | null
          gateway_payload: Json | null
          gateway_ref: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          processed_by: string | null
          status: Database["public"]["Enums"]["payment_status"]
          tenant_id: string
        }
        Insert: {
          amount_minor: number
          branch_id: string
          completed_at?: string | null
          created_at?: string
          currency_code?: string
          failed_at?: string | null
          failure_reason?: string | null
          gateway_payload?: Json | null
          gateway_ref?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          processed_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tenant_id: string
        }
        Update: {
          amount_minor?: number
          branch_id?: string
          completed_at?: string | null
          created_at?: string
          currency_code?: string
          failed_at?: string | null
          failure_reason?: string | null
          gateway_payload?: Json | null
          gateway_ref?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          processed_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_refunds: {
        Row: {
          branch_id: string
          created_at: string
          currency_code: string
          gateway_ref: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string
          issued_by: string | null
          payment_id: string | null
          reason: string
          refund_amount_minor: number
          tenant_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          currency_code?: string
          gateway_ref?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          issued_by?: string | null
          payment_id?: string | null
          reason: string
          refund_amount_minor: number
          tenant_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          currency_code?: string
          gateway_ref?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          issued_by?: string | null
          payment_id?: string | null
          reason?: string
          refund_amount_minor?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_refunds_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "billing_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          amount_paid_minor: number
          amount_refunded_minor: number
          bill_number: string
          branch_id: string
          created_at: string
          currency_code: string
          discount_total_minor: number
          grand_total_minor: number
          id: string
          parent_bill_id: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["bill_status"]
          subtotal_minor: number
          table_id: string | null
          tax_total_minor: number
          tenant_id: string
          updated_at: string
          version_num: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_paid_minor?: number
          amount_refunded_minor?: number
          bill_number: string
          branch_id: string
          created_at?: string
          currency_code?: string
          discount_total_minor?: number
          grand_total_minor: number
          id?: string
          parent_bill_id?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["bill_status"]
          subtotal_minor: number
          table_id?: string | null
          tax_total_minor?: number
          tenant_id: string
          updated_at?: string
          version_num?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_paid_minor?: number
          amount_refunded_minor?: number
          bill_number?: string
          branch_id?: string
          created_at?: string
          currency_code?: string
          discount_total_minor?: number
          grand_total_minor?: number
          id?: string
          parent_bill_id?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["bill_status"]
          subtotal_minor?: number
          table_id?: string | null
          tax_total_minor?: number
          tenant_id?: string
          updated_at?: string
          version_num?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bills_parent_bill_id_fkey"
            columns: ["parent_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_category_overrides: {
        Row: {
          branch_id: string
          category_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_visible: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id: string
          category_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_visible?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string
          category_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_visible?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_category_overrides_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_category_overrides_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_category_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_category_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_category_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_cat_override_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_cat_override_category"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_item_availability: {
        Row: {
          availability_status: string
          branch_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          disabled_until: string | null
          id: string
          is_active: boolean
          menu_item_id: string
          priority: number
          reason: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          availability_status: string
          branch_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          disabled_until?: string | null
          id?: string
          is_active?: boolean
          menu_item_id: string
          priority?: number
          reason?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          availability_status?: string
          branch_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          disabled_until?: string | null
          id?: string
          is_active?: boolean
          menu_item_id?: string
          priority?: number
          reason?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_branch_item_avail_branch"
            columns: ["tenant_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_branch_item_avail_menu_item"
            columns: ["tenant_id", "menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      branch_menu_item_overrides: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_visible: boolean
          menu_item_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_visible?: boolean
          menu_item_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_visible?: boolean
          menu_item_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_menu_item_overrides_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_menu_item_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_menu_item_overrides_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_menu_item_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_menu_item_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_item_override_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_item_override_item"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_menu_item_overrides_legacy_archived: {
        Row: {
          branch_id: string
          created_at: string
          is_available: boolean | null
          item_id: string
          override_price: number | null
          sort_order: number | null
          tax_group_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          is_available?: boolean | null
          item_id: string
          override_price?: number | null
          sort_order?: number | null
          tax_group_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          is_available?: boolean | null
          item_id?: string
          override_price?: number | null
          sort_order?: number | null
          tax_group_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_branch_item_override_branch"
            columns: ["tenant_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_branch_item_override_item"
            columns: ["tenant_id", "item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      branch_modifier_group_overrides: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_available: boolean
          modifier_group_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_available?: boolean
          modifier_group_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_available?: boolean
          modifier_group_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_modifier_group_overrides_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_modifier_group_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_modifier_group_overrides_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_modifier_group_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_modifier_group_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_mod_group_override_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_mod_group_override_group"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_modifier_option_overrides: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_available: boolean
          modifier_option_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_available?: boolean
          modifier_option_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_available?: boolean
          modifier_option_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_modifier_option_overrides_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_modifier_option_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_modifier_option_overrides_modifier_option_id_fkey"
            columns: ["modifier_option_id"]
            isOneToOne: false
            referencedRelation: "modifier_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_modifier_option_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_modifier_option_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_mod_option_override_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_mod_option_override_option"
            columns: ["modifier_option_id"]
            isOneToOne: false
            referencedRelation: "modifier_options"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_operational_events: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          branch_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
          sequence_number: number
          tenant_id: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          branch_id: string
          created_at?: string
          event_type: string
          id?: string
          payload: Json
          sequence_number?: number
          tenant_id: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          branch_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          sequence_number?: number
          tenant_id?: string
        }
        Relationships: []
      }
      branch_price_overrides: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          ends_at: string | null
          id: string
          menu_item_id: string
          price_minor: number
          starts_at: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          ends_at?: string | null
          id?: string
          menu_item_id: string
          price_minor: number
          starts_at?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          ends_at?: string | null
          id?: string
          menu_item_id?: string
          price_minor?: number
          starts_at?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_price_overrides_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_price_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_price_overrides_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_price_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_price_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_price_override_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_price_override_item"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_sequences: {
        Row: {
          branch_id: string
          created_at: string
          current_val: number
          id: string
          last_reset_date: string
          sequence_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          current_val?: number
          id?: string
          last_reset_date?: string
          sequence_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          current_val?: number
          id?: string
          last_reset_date?: string
          sequence_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          active_published_snapshot_id: string | null
          address: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          region: string | null
          status: string
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          active_published_snapshot_id?: string | null
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          region?: string | null
          status?: string
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          active_published_snapshot_id?: string | null
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          region?: string | null
          status?: string
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_item_modifiers: {
        Row: {
          cart_item_id: string
          created_at: string
          id: string
          modifier_group_id: string
          modifier_group_name_snapshot: string
          modifier_option_id: string
          modifier_option_name_snapshot: string
          price_delta_minor_snapshot: number
          tenant_id: string
        }
        Insert: {
          cart_item_id: string
          created_at?: string
          id?: string
          modifier_group_id: string
          modifier_group_name_snapshot: string
          modifier_option_id: string
          modifier_option_name_snapshot: string
          price_delta_minor_snapshot?: number
          tenant_id: string
        }
        Update: {
          cart_item_id?: string
          created_at?: string
          id?: string
          modifier_group_id?: string
          modifier_group_name_snapshot?: string
          modifier_option_id?: string
          modifier_option_name_snapshot?: string
          price_delta_minor_snapshot?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_item_modifiers_cart_item_id_fkey"
            columns: ["cart_item_id"]
            isOneToOne: false
            referencedRelation: "cart_items"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          display_order: number
          id: string
          item_name_snapshot: string
          item_notes: string | null
          item_sku_snapshot: string | null
          menu_item_id: string
          quantity: number
          tenant_id: string
          unit_price_minor_snapshot: number
          updated_at: string
          version_num: number
        }
        Insert: {
          cart_id: string
          created_at?: string
          display_order?: number
          id?: string
          item_name_snapshot: string
          item_notes?: string | null
          item_sku_snapshot?: string | null
          menu_item_id: string
          quantity?: number
          tenant_id: string
          unit_price_minor_snapshot: number
          updated_at?: string
          version_num?: number
        }
        Update: {
          cart_id?: string
          created_at?: string
          display_order?: number
          id?: string
          item_name_snapshot?: string
          item_notes?: string | null
          item_sku_snapshot?: string | null
          menu_item_id?: string
          quantity?: number
          tenant_id?: string
          unit_price_minor_snapshot?: number
          updated_at?: string
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          abandoned_at: string | null
          branch_id: string
          checkout_idempotency_key: string | null
          created_at: string
          expires_at: string | null
          id: string
          locked_at: string | null
          order_notes: string | null
          session_id: string
          status: Database["public"]["Enums"]["cart_status"]
          submitted_at: string | null
          table_id: string
          tenant_id: string
          updated_at: string
          version_num: number
        }
        Insert: {
          abandoned_at?: string | null
          branch_id: string
          checkout_idempotency_key?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          locked_at?: string | null
          order_notes?: string | null
          session_id: string
          status?: Database["public"]["Enums"]["cart_status"]
          submitted_at?: string | null
          table_id: string
          tenant_id: string
          updated_at?: string
          version_num?: number
        }
        Update: {
          abandoned_at?: string | null
          branch_id?: string
          checkout_idempotency_key?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          locked_at?: string | null
          order_notes?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["cart_status"]
          submitted_at?: string | null
          table_id?: string
          tenant_id?: string
          updated_at?: string
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "carts_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_invites: {
        Row: {
          branch_ids: string[]
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          invite_token: string
          is_used: boolean
          role: string
          tenant_id: string
          updated_at: string
          used_at: string | null
        }
        Insert: {
          branch_ids?: string[]
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          invite_token: string
          is_used?: boolean
          role?: string
          tenant_id: string
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          branch_ids?: string[]
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          invite_token?: string
          is_used?: boolean
          role?: string
          tenant_id?: string
          updated_at?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_identities: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          tenant_id?: string
        }
        Relationships: []
      }
      dead_letter_events: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          event_id: string
          event_type: string
          failed_at: string
          id: string
          payload: Json
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          tenant_id: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          event_id: string
          event_type: string
          failed_at?: string
          id?: string
          payload: Json
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          tenant_id: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          event_id?: string
          event_type?: string
          failed_at?: string
          id?: string
          payload?: Json
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dead_letter_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dead_letter_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      device_heartbeats: {
        Row: {
          client_ip: string | null
          device_id: string
          id: string
          metadata: Json
          received_at: string
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          client_ip?: string | null
          device_id: string
          id?: string
          metadata?: Json
          received_at?: string
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          client_ip?: string | null
          device_id?: string
          id?: string
          metadata?: Json
          received_at?: string
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_sessions: {
        Row: {
          country_code: string | null
          created_at: string
          device_fingerprint: string
          expires_at: string
          id: string
          ip_address: unknown
          is_active: boolean
          last_token_hash: string | null
          revoke_reason: string | null
          revoked_at: string | null
          supabase_session_id: string | null
          tenant_id: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          device_fingerprint: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          is_active?: boolean
          last_token_hash?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          supabase_session_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          device_fingerprint?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          is_active?: boolean
          last_token_hash?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          supabase_session_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      device_validation_registry: {
        Row: {
          device_identifier: string
          device_type: string
          id: string
          is_authorized: boolean
          last_seen_at: string
          tenant_id: string
          trust_score: number
        }
        Insert: {
          device_identifier: string
          device_type: string
          id?: string
          is_authorized?: boolean
          last_seen_at?: string
          tenant_id: string
          trust_score?: number
        }
        Update: {
          device_identifier?: string
          device_type?: string
          id?: string
          is_authorized?: boolean
          last_seen_at?: string
          tenant_id?: string
          trust_score?: number
        }
        Relationships: []
      }
      devices: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          device_fingerprint: string | null
          device_token_hash: string
          device_type: Database["public"]["Enums"]["device_type"]
          display_name: string
          id: string
          last_seen_at: string | null
          registered_at: string
          registered_by: string | null
          status: Database["public"]["Enums"]["device_status"]
          suspended_at: string | null
          suspended_by: string | null
          suspension_reason: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          device_fingerprint?: string | null
          device_token_hash: string
          device_type: Database["public"]["Enums"]["device_type"]
          display_name: string
          id?: string
          last_seen_at?: string | null
          registered_at?: string
          registered_by?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          device_fingerprint?: string | null
          device_token_hash?: string
          device_type?: Database["public"]["Enums"]["device_type"]
          display_name?: string
          id?: string
          last_seen_at?: string | null
          registered_at?: string
          registered_by?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: []
      }
      distributed_rate_limits: {
        Row: {
          expires_at: string
          key: string
          request_count: number
          window_start: string
        }
        Insert: {
          expires_at: string
          key: string
          request_count?: number
          window_start: string
        }
        Update: {
          expires_at?: string
          key?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      dlq_metrics: {
        Row: {
          action: string
          created_at: string
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          retry_attempts: number
        }
        Insert: {
          action: string
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          last_error?: string | null
          retry_attempts: number
        }
        Update: {
          action?: string
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          retry_attempts?: number
        }
        Relationships: []
      }
      domain_events: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          branch_id: string | null
          delivery_status: string
          error_reason: string | null
          event_type: string
          id: string
          last_attempt_at: string | null
          locked_by: string | null
          locked_until: string | null
          occurred_at: string
          partition_key: string
          payload: Json
          retry_count: number
          sequence_num: number
          tenant_id: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          branch_id?: string | null
          delivery_status?: string
          error_reason?: string | null
          event_type: string
          id?: string
          last_attempt_at?: string | null
          locked_by?: string | null
          locked_until?: string | null
          occurred_at?: string
          partition_key?: string
          payload?: Json
          retry_count?: number
          sequence_num?: number
          tenant_id: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          branch_id?: string | null
          delivery_status?: string
          error_reason?: string | null
          event_type?: string
          id?: string
          last_attempt_at?: string | null
          locked_by?: string | null
          locked_until?: string | null
          occurred_at?: string
          partition_key?: string
          payload?: Json
          retry_count?: number
          sequence_num?: number
          tenant_id?: string
        }
        Relationships: []
      }
      dynamic_pricing_rules: {
        Row: {
          created_at: string
          days_of_week: number[]
          end_time: string | null
          id: string
          is_active: boolean
          name: string
          rule_type: string
          start_time: string | null
          target_categories: string[]
          tenant_id: string
          updated_at: string
          value_minor: number
        }
        Insert: {
          created_at?: string
          days_of_week?: number[]
          end_time?: string | null
          id?: string
          is_active?: boolean
          name: string
          rule_type: string
          start_time?: string | null
          target_categories?: string[]
          tenant_id: string
          updated_at?: string
          value_minor: number
        }
        Update: {
          created_at?: string
          days_of_week?: number[]
          end_time?: string | null
          id?: string
          is_active?: boolean
          name?: string
          rule_type?: string
          start_time?: string | null
          target_categories?: string[]
          tenant_id?: string
          updated_at?: string
          value_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dynamic_pricing_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_consumers: {
        Row: {
          consumer_name: string
          event_id: string
          id: string
          processed_at: string
          tenant_id: string
        }
        Insert: {
          consumer_name: string
          event_id: string
          id?: string
          processed_at?: string
          tenant_id: string
        }
        Update: {
          consumer_name?: string
          event_id?: string
          id?: string
          processed_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_consumers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_deliveries: {
        Row: {
          attempt_count: number
          channel: string
          channel_target: string | null
          created_at: string
          delivered_at: string | null
          error_detail: string | null
          event_id: string
          id: string
          last_attempted_at: string | null
          next_retry_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          channel: string
          channel_target?: string | null
          created_at?: string
          delivered_at?: string | null
          error_detail?: string | null
          event_id: string
          id?: string
          last_attempted_at?: string | null
          next_retry_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          channel?: string
          channel_target?: string | null
          created_at?: string
          delivered_at?: string | null
          error_detail?: string | null
          event_id?: string
          id?: string
          last_attempted_at?: string | null
          next_retry_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      failed_dispatch_attempts: {
        Row: {
          attempt_num: number
          attempted_at: string
          error_message: string | null
          event_id: string
          id: string
        }
        Insert: {
          attempt_num: number
          attempted_at?: string
          error_message?: string | null
          event_id: string
          id?: string
        }
        Update: {
          attempt_num?: number
          attempted_at?: string
          error_message?: string | null
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "failed_dispatch_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_events: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          branch_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
          sequence_number: number
          tenant_id: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          branch_id: string
          created_at?: string
          event_type: string
          id?: string
          payload: Json
          sequence_number?: number
          tenant_id: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          branch_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          sequence_number?: number
          tenant_id?: string
        }
        Relationships: []
      }
      guest_sessions: {
        Row: {
          branch_id: string | null
          closed_reason: string | null
          created_at: string
          ended_at: string | null
          expires_at: string | null
          guest_identifier: string | null
          id: string
          is_active: boolean
          last_activity_at: string
          qr_code_id: string | null
          resolved_at: string | null
          session_data: Json
          session_token: string
          started_at: string
          table_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          closed_reason?: string | null
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          guest_identifier?: string | null
          id?: string
          is_active?: boolean
          last_activity_at?: string
          qr_code_id?: string | null
          resolved_at?: string | null
          session_data?: Json
          session_token: string
          started_at?: string
          table_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          closed_reason?: string | null
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          guest_identifier?: string | null
          id?: string
          is_active?: boolean
          last_activity_at?: string
          qr_code_id?: string | null
          resolved_at?: string | null
          session_data?: Json
          session_token?: string
          started_at?: string
          table_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_sessions_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          request_hash: string | null
          request_path: string
          response_body: Json
          response_status: number
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          idempotency_key: string
          request_hash?: string | null
          request_path: string
          response_body?: Json
          response_status: number
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          request_hash?: string | null
          request_path?: string
          response_body?: Json
          response_status?: number
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      idempotency_registry: {
        Row: {
          created_at: string
          expires_at: string
          idempotency_key: string
          response_payload: Json
          tenant_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          idempotency_key: string
          response_payload?: Json
          tenant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          idempotency_key?: string
          response_payload?: Json
          tenant_id?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount_due_minor: number | null
          amount_paid_minor: number
          branch_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          discount_total_minor: number
          grand_total_minor: number
          id: string
          idempotency_key: string | null
          invoice_number: string
          issued_at: string | null
          order_id: string
          order_snapshot_id: string
          sequence_num: number | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_minor: number
          tax_total_minor: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_due_minor?: number | null
          amount_paid_minor?: number
          branch_id: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          discount_total_minor?: number
          grand_total_minor: number
          id?: string
          idempotency_key?: string | null
          invoice_number: string
          issued_at?: string | null
          order_id: string
          order_snapshot_id: string
          sequence_num?: number | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_minor: number
          tax_total_minor?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_due_minor?: number | null
          amount_paid_minor?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          discount_total_minor?: number
          grand_total_minor?: number
          id?: string
          idempotency_key?: string | null
          invoice_number?: string
          issued_at?: string | null
          order_id?: string
          order_snapshot_id?: string
          sequence_num?: number | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_minor?: number
          tax_total_minor?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_order_snapshot_id_fkey"
            columns: ["order_snapshot_id"]
            isOneToOne: false
            referencedRelation: "order_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      item_availability_exceptions: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          ends_at: string
          exception_type: string
          id: string
          is_active: boolean
          menu_item_id: string
          priority: number
          starts_at: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          ends_at: string
          exception_type: string
          id?: string
          is_active?: boolean
          menu_item_id: string
          priority?: number
          starts_at: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          ends_at?: string
          exception_type?: string
          id?: string
          is_active?: boolean
          menu_item_id?: string
          priority?: number
          starts_at?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_item_avail_exception_branch"
            columns: ["tenant_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_item_avail_exception_menu_item"
            columns: ["tenant_id", "menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      kitchen_item_preparations: {
        Row: {
          branch_id: string
          completed_at: string | null
          completed_quantity: number
          created_at: string
          id: string
          kitchen_order_id: string
          kitchen_order_item_id: string
          prepared_at: string | null
          quantity: number
          station_id: string | null
          status: Database["public"]["Enums"]["kitchen_item_status"]
          tenant_id: string
          updated_at: string
          version_num: number
        }
        Insert: {
          branch_id: string
          completed_at?: string | null
          completed_quantity?: number
          created_at?: string
          id?: string
          kitchen_order_id: string
          kitchen_order_item_id: string
          prepared_at?: string | null
          quantity: number
          station_id?: string | null
          status?: Database["public"]["Enums"]["kitchen_item_status"]
          tenant_id: string
          updated_at?: string
          version_num?: number
        }
        Update: {
          branch_id?: string
          completed_at?: string | null
          completed_quantity?: number
          created_at?: string
          id?: string
          kitchen_order_id?: string
          kitchen_order_item_id?: string
          prepared_at?: string | null
          quantity?: number
          station_id?: string | null
          status?: Database["public"]["Enums"]["kitchen_item_status"]
          tenant_id?: string
          updated_at?: string
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_item_preparations_kitchen_order_id_fkey"
            columns: ["kitchen_order_id"]
            isOneToOne: false
            referencedRelation: "kitchen_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_item_preparations_kitchen_order_item_id_fkey"
            columns: ["kitchen_order_item_id"]
            isOneToOne: false
            referencedRelation: "kitchen_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_item_preparations_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "kitchen_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_order_items: {
        Row: {
          created_at: string
          display_order: number
          id: string
          item_name: string
          item_notes: string | null
          kitchen_order_id: string
          modifier_summary: string | null
          order_item_snapshot_id: string
          quantity: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          item_name: string
          item_notes?: string | null
          kitchen_order_id: string
          modifier_summary?: string | null
          order_item_snapshot_id: string
          quantity: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          item_name?: string
          item_notes?: string | null
          kitchen_order_id?: string
          modifier_summary?: string | null
          order_item_snapshot_id?: string
          quantity?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_order_items_kitchen_order_id_fkey"
            columns: ["kitchen_order_id"]
            isOneToOne: false
            referencedRelation: "kitchen_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_order_items_order_item_snapshot_id_fkey"
            columns: ["order_item_snapshot_id"]
            isOneToOne: false
            referencedRelation: "order_item_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_orders: {
        Row: {
          accepted_at: string | null
          branch_id: string
          created_at: string
          created_by: string | null
          delivered_at: string | null
          estimated_prep_seconds: number | null
          id: string
          kitchen_notes: string | null
          order_id: string
          preparing_at: string | null
          priority: number
          ready_at: string | null
          round_number: number
          sequence_num: number | null
          station_id: string | null
          status: Database["public"]["Enums"]["kitchen_order_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          accepted_at?: string | null
          branch_id: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          estimated_prep_seconds?: number | null
          id?: string
          kitchen_notes?: string | null
          order_id: string
          preparing_at?: string | null
          priority?: number
          ready_at?: string | null
          round_number?: number
          sequence_num?: number | null
          station_id?: string | null
          status?: Database["public"]["Enums"]["kitchen_order_status"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          accepted_at?: string | null
          branch_id?: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          estimated_prep_seconds?: number | null
          id?: string
          kitchen_notes?: string | null
          order_id?: string
          preparing_at?: string | null
          priority?: number
          ready_at?: string | null
          round_number?: number
          sequence_num?: number | null
          station_id?: string | null
          status?: Database["public"]["Enums"]["kitchen_order_status"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_orders_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "kitchen_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_stations: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: []
      }
      menu_categories: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_category_branch_visibility: {
        Row: {
          branch_id: string
          category_id: string
          created_at: string
          is_visible: boolean
          sort_order: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          category_id: string
          created_at?: string
          is_visible?: boolean
          sort_order?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          category_id?: string
          created_at?: string
          is_visible?: boolean
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_cat_visibility_branch"
            columns: ["tenant_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_cat_visibility_category"
            columns: ["tenant_id", "category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      menu_item_images: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          is_primary: boolean
          item_id: string
          sort_order: number
          tenant_id: string
          url: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          item_id: string
          sort_order?: number
          tenant_id: string
          url: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          item_id?: string
          sort_order?: number
          tenant_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_item_images_item"
            columns: ["tenant_id", "item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      menu_item_modifier_groups: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          display_order: number
          id: string
          is_active: boolean
          menu_item_id: string
          modifier_group_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          menu_item_id: string
          modifier_group_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          menu_item_id?: string
          modifier_group_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_modifier_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_modifier_groups_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_modifier_groups_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_modifier_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_modifier_groups_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_prices: {
        Row: {
          amount_minor: number
          created_at: string
          created_by: string | null
          currency_code: string
          deleted_at: string | null
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          menu_item_id: string
          pricing_tier: string
          priority: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          amount_minor: number
          created_at?: string
          created_by?: string | null
          currency_code?: string
          deleted_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          menu_item_id: string
          pricing_tier?: string
          priority?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          amount_minor?: number
          created_at?: string
          created_by?: string | null
          currency_code?: string
          deleted_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          menu_item_id?: string
          pricing_tier?: string
          priority?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_prices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_prices_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_prices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_prices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_recommendations: {
        Row: {
          branch_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          priority: number
          recommendation_type: string
          recommended_menu_item_id: string
          source_menu_item_id: string
          tenant_id: string
          updated_at: string
          version_num: number
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          priority?: number
          recommendation_type: string
          recommended_menu_item_id: string
          source_menu_item_id: string
          tenant_id: string
          updated_at?: string
          version_num?: number
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          priority?: number
          recommendation_type?: string
          recommended_menu_item_id?: string
          source_menu_item_id?: string
          tenant_id?: string
          updated_at?: string
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_recommendations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_recommendations_recommended_menu_item_id_fkey"
            columns: ["recommended_menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_recommendations_source_menu_item_id_fkey"
            columns: ["source_menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_recommendations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_station_routes: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          menu_item_id: string
          station_id: string
          tenant_id: string
          updated_at: string
          version_num: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          menu_item_id: string
          station_id: string
          tenant_id: string
          updated_at?: string
          version_num?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          menu_item_id?: string
          station_id?: string
          tenant_id?: string
          updated_at?: string
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_station_routes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_station_routes_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "kitchen_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_tax_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_active: boolean
          menu_item_id: string
          tax_profile_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          menu_item_id: string
          tax_profile_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          menu_item_id?: string
          tax_profile_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_tax_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_tax_profiles_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_tax_profiles_tax_profile_id_fkey"
            columns: ["tax_profile_id"]
            isOneToOne: false
            referencedRelation: "tax_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_tax_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_tax_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergen: string | null
          base_price: number
          category: string
          category_id: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          dietary_tags: string[]
          id: string
          image_url: string | null
          is_available: boolean | null
          is_featured: boolean
          is_veg: boolean | null
          name: string
          prep_time_minutes: number | null
          price: number
          pricing_type: Database["public"]["Enums"]["pricing_type"]
          search_vector: unknown
          short_description: string | null
          sku: string | null
          slug: string
          sort_order: number | null
          spice_level: Database["public"]["Enums"]["spice_level"]
          station: string | null
          status: Database["public"]["Enums"]["menu_item_status"]
          tax_group_id: string | null
          tenant_id: string | null
          thumbnail_url: string | null
          updated_at: string | null
          updated_by: string | null
          version_num: number
        }
        Insert: {
          allergen?: string | null
          base_price?: number
          category: string
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          dietary_tags?: string[]
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_featured?: boolean
          is_veg?: boolean | null
          name: string
          prep_time_minutes?: number | null
          price: number
          pricing_type?: Database["public"]["Enums"]["pricing_type"]
          search_vector?: unknown
          short_description?: string | null
          sku?: string | null
          slug: string
          sort_order?: number | null
          spice_level?: Database["public"]["Enums"]["spice_level"]
          station?: string | null
          status?: Database["public"]["Enums"]["menu_item_status"]
          tax_group_id?: string | null
          tenant_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          allergen?: string | null
          base_price?: number
          category?: string
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          dietary_tags?: string[]
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          is_featured?: boolean
          is_veg?: boolean | null
          name?: string
          prep_time_minutes?: number | null
          price?: number
          pricing_type?: Database["public"]["Enums"]["pricing_type"]
          search_vector?: unknown
          short_description?: string | null
          sku?: string | null
          slug?: string
          sort_order?: number | null
          spice_level?: Database["public"]["Enums"]["spice_level"]
          station?: string | null
          status?: Database["public"]["Enums"]["menu_item_status"]
          tax_group_id?: string | null
          tenant_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_snapshots: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          id: string
          snapshot_data: Json
          snapshot_type: string
          snapshot_version: number
          tenant_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          snapshot_data: Json
          snapshot_type: string
          snapshot_version?: number
          tenant_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          snapshot_data?: Json
          snapshot_type?: string
          snapshot_version?: number
          tenant_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_snapshots_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          allow_quantity: boolean
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_required: boolean
          max_quantity_per_option: number
          max_select: number
          min_quantity_per_option: number
          min_select: number
          name: string
          selection_mode: Database["public"]["Enums"]["modifier_selection_mode"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          allow_quantity?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_required?: boolean
          max_quantity_per_option?: number
          max_select?: number
          min_quantity_per_option?: number
          min_select?: number
          name: string
          selection_mode?: Database["public"]["Enums"]["modifier_selection_mode"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          allow_quantity?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_required?: boolean
          max_quantity_per_option?: number
          max_select?: number
          min_quantity_per_option?: number
          min_select?: number
          name?: string
          selection_mode?: Database["public"]["Enums"]["modifier_selection_mode"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_groups_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_options: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_default: boolean
          modifier_group_id: string
          name: string
          parent_modifier_option_id: string | null
          price_delta_minor: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          modifier_group_id: string
          name: string
          parent_modifier_option_id?: string | null
          price_delta_minor?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          modifier_group_id?: string
          name?: string
          parent_modifier_option_id?: string | null
          price_delta_minor?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifier_options_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_options_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_options_parent_modifier_option_id_fkey"
            columns: ["parent_modifier_option_id"]
            isOneToOne: false
            referencedRelation: "modifier_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_options_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_options_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      mutation_audit_logs: {
        Row: {
          acknowledged_at: string | null
          branch_id: string
          created_at: string
          failure_reason: string | null
          idempotency_key: string
          mutation_id: string
          mutation_sequence: number
          mutation_type: string
          payload_hash: string | null
          resolved_at: string | null
          session_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          branch_id: string
          created_at?: string
          failure_reason?: string | null
          idempotency_key: string
          mutation_id: string
          mutation_sequence: number
          mutation_type: string
          payload_hash?: string | null
          resolved_at?: string | null
          session_id: string
          status: string
          tenant_id: string
        }
        Update: {
          acknowledged_at?: string | null
          branch_id?: string
          created_at?: string
          failure_reason?: string | null
          idempotency_key?: string
          mutation_id?: string
          mutation_sequence?: number
          mutation_type?: string
          payload_hash?: string | null
          resolved_at?: string | null
          session_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mutation_audit_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mutation_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_state: {
        Row: {
          completed_at: string | null
          is_complete: boolean
          is_skipped: boolean
          steps_completed: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          is_complete?: boolean
          is_skipped?: boolean
          steps_completed?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          is_complete?: boolean
          is_skipped?: boolean
          steps_completed?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_snapshots: {
        Row: {
          display_order: number
          id: string
          is_branch_price_override: boolean
          item_category_name_snapshot: string | null
          item_name_snapshot: string
          item_notes: string | null
          item_sku_snapshot: string | null
          line_total_minor: number
          menu_item_id: string
          order_snapshot_id: string
          quantity: number
          snapshotted_at: string
          tenant_id: string
          unit_price_minor: number
        }
        Insert: {
          display_order?: number
          id?: string
          is_branch_price_override?: boolean
          item_category_name_snapshot?: string | null
          item_name_snapshot: string
          item_notes?: string | null
          item_sku_snapshot?: string | null
          line_total_minor: number
          menu_item_id: string
          order_snapshot_id: string
          quantity: number
          snapshotted_at?: string
          tenant_id: string
          unit_price_minor: number
        }
        Update: {
          display_order?: number
          id?: string
          is_branch_price_override?: boolean
          item_category_name_snapshot?: string | null
          item_name_snapshot?: string
          item_notes?: string | null
          item_sku_snapshot?: string | null
          line_total_minor?: number
          menu_item_id?: string
          order_snapshot_id?: string
          quantity?: number
          snapshotted_at?: string
          tenant_id?: string
          unit_price_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_snapshots_order_snapshot_id_fkey"
            columns: ["order_snapshot_id"]
            isOneToOne: false
            referencedRelation: "order_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          allergen: string | null
          done: boolean | null
          id: string
          is_rejected: boolean | null
          menu_item_id: string | null
          modifiers: Json | null
          name: string
          note: string | null
          order_id: string | null
          qty: number | null
          station: string | null
          status: string | null
          unit_price: number
        }
        Insert: {
          allergen?: string | null
          done?: boolean | null
          id?: string
          is_rejected?: boolean | null
          menu_item_id?: string | null
          modifiers?: Json | null
          name: string
          note?: string | null
          order_id?: string | null
          qty?: number | null
          station?: string | null
          status?: string | null
          unit_price: number
        }
        Update: {
          allergen?: string | null
          done?: boolean | null
          id?: string
          is_rejected?: boolean | null
          menu_item_id?: string | null
          modifiers?: Json | null
          name?: string
          note?: string | null
          order_id?: string | null
          qty?: number | null
          station?: string | null
          status?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_order_items_order_id"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_modifier_snapshots: {
        Row: {
          id: string
          modifier_group_id: string
          modifier_group_name_snapshot: string
          modifier_option_id: string
          modifier_option_name_snapshot: string
          order_item_snapshot_id: string
          price_delta_minor: number
          snapshotted_at: string
          tenant_id: string
        }
        Insert: {
          id?: string
          modifier_group_id: string
          modifier_group_name_snapshot: string
          modifier_option_id: string
          modifier_option_name_snapshot: string
          order_item_snapshot_id: string
          price_delta_minor?: number
          snapshotted_at?: string
          tenant_id: string
        }
        Update: {
          id?: string
          modifier_group_id?: string
          modifier_group_name_snapshot?: string
          modifier_option_id?: string
          modifier_option_name_snapshot?: string
          order_item_snapshot_id?: string
          price_delta_minor?: number
          snapshotted_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_modifier_snapshots_order_item_snapshot_id_fkey"
            columns: ["order_item_snapshot_id"]
            isOneToOne: false
            referencedRelation: "order_item_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      order_rate_limits: {
        Row: {
          request_count: number
          table_id: string
          updated_at: string
          window_start: string
        }
        Insert: {
          request_count?: number
          table_id: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          request_count?: number
          table_id?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_rate_limits_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: true
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      order_reviews: {
        Row: {
          branch_id: string
          comment: string | null
          created_at: string
          food_rating: number
          guest_session_id: string | null
          id: string
          order_id: string
          service_rating: number
          table_id: string
          tenant_id: string
        }
        Insert: {
          branch_id: string
          comment?: string | null
          created_at?: string
          food_rating: number
          guest_session_id?: string | null
          id?: string
          order_id: string
          service_rating: number
          table_id: string
          tenant_id: string
        }
        Update: {
          branch_id?: string
          comment?: string | null
          created_at?: string
          food_rating?: number
          guest_session_id?: string | null
          id?: string
          order_id?: string
          service_rating?: number
          table_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_reviews_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_reviews_guest_session_id_fkey"
            columns: ["guest_session_id"]
            isOneToOne: false
            referencedRelation: "guest_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_reviews_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_snapshots: {
        Row: {
          availability_version: string
          branch_id: string
          checkout_timestamp: string | null
          currency_code: string
          discount_total_minor: number
          grand_total_minor: number
          id: string
          item_count: number
          menu_snapshot_hash: string | null
          order_id: string | null
          override_version: string
          pricing_version: string
          snapshot_version: number
          snapshotted_at: string
          subtotal_minor: number
          tax_total_minor: number
          tax_version: string
          tenant_id: string
        }
        Insert: {
          availability_version?: string
          branch_id: string
          checkout_timestamp?: string | null
          currency_code?: string
          discount_total_minor?: number
          grand_total_minor: number
          id?: string
          item_count: number
          menu_snapshot_hash?: string | null
          order_id?: string | null
          override_version?: string
          pricing_version?: string
          snapshot_version?: number
          snapshotted_at?: string
          subtotal_minor: number
          tax_total_minor?: number
          tax_version?: string
          tenant_id: string
        }
        Update: {
          availability_version?: string
          branch_id?: string
          checkout_timestamp?: string | null
          currency_code?: string
          discount_total_minor?: number
          grand_total_minor?: number
          id?: string
          item_count?: number
          menu_snapshot_hash?: string | null
          order_id?: string | null
          override_version?: string
          pricing_version?: string
          snapshot_version?: number
          snapshotted_at?: string
          subtotal_minor?: number
          tax_total_minor?: number
          tax_version?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_snapshots_order_id_fk"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_state_history: {
        Row: {
          branch_id: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: string
          metadata: Json
          occurred_at: string
          order_id: string
          reason: string | null
          tenant_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          branch_id: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          metadata?: Json
          occurred_at?: string
          order_id: string
          reason?: string | null
          tenant_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          branch_id?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          metadata?: Json
          occurred_at?: string
          order_id?: string
          reason?: string | null
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_state_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_tax_snapshots: {
        Row: {
          calc_mode_snapshot: string
          id: string
          jurisdiction_snapshot: string | null
          order_snapshot_id: string
          rate_basis_points: number
          snapshotted_at: string
          tax_amount_minor: number
          tax_profile_name_snapshot: string
          tax_strategy_id: string
          taxable_amount_minor: number
          tenant_id: string
        }
        Insert: {
          calc_mode_snapshot: string
          id?: string
          jurisdiction_snapshot?: string | null
          order_snapshot_id: string
          rate_basis_points: number
          snapshotted_at?: string
          tax_amount_minor: number
          tax_profile_name_snapshot: string
          tax_strategy_id: string
          taxable_amount_minor: number
          tenant_id: string
        }
        Update: {
          calc_mode_snapshot?: string
          id?: string
          jurisdiction_snapshot?: string | null
          order_snapshot_id?: string
          rate_basis_points?: number
          snapshotted_at?: string
          tax_amount_minor?: number
          tax_profile_name_snapshot?: string
          tax_strategy_id?: string
          taxable_amount_minor?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_tax_snapshots_order_snapshot_id_fkey"
            columns: ["order_snapshot_id"]
            isOneToOne: false
            referencedRelation: "order_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          branch_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cart_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          expires_at: string | null
          id: string
          idempotency_key: string | null
          order_notes: string | null
          order_number: string
          order_snapshot_id: string | null
          paid_at: string | null
          payment_method: string | null
          payment_status: string
          preparing_at: string | null
          ready_at: string | null
          review_completed_at: string | null
          review_expires_at: string | null
          review_requested_at: string | null
          review_skipped_at: string | null
          sequence_num: number | null
          session_id: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          table_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          accepted_at?: string | null
          branch_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cart_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          order_notes?: string | null
          order_number: string
          order_snapshot_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: string
          preparing_at?: string | null
          ready_at?: string | null
          review_completed_at?: string | null
          review_expires_at?: string | null
          review_requested_at?: string | null
          review_skipped_at?: string | null
          sequence_num?: number | null
          session_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          table_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          accepted_at?: string | null
          branch_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cart_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          order_notes?: string | null
          order_number?: string
          order_snapshot_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: string
          preparing_at?: string | null
          ready_at?: string | null
          review_completed_at?: string | null
          review_expires_at?: string | null
          review_requested_at?: string | null
          review_skipped_at?: string | null
          sequence_num?: number | null
          session_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_order_snapshot_id_fkey"
            columns: ["order_snapshot_id"]
            isOneToOne: false
            referencedRelation: "order_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount_minor: number
          bill_id: string
          branch_id: string
          created_at: string
          currency_code: string
          expires_at: string
          id: string
          idempotency_key: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          status: Database["public"]["Enums"]["intent_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          bill_id: string
          branch_id: string
          created_at?: string
          currency_code?: string
          expires_at: string
          id?: string
          idempotency_key: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          status?: Database["public"]["Enums"]["intent_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          bill_id?: string
          branch_id?: string
          created_at?: string
          currency_code?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          status?: Database["public"]["Enums"]["intent_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_ledger: {
        Row: {
          branch_id: string
          currency_code: string
          finalized_at: string | null
          id: string
          idempotency_key: string
          initiated_at: string
          order_id: string
          payment_amount_minor: number
          payment_provider: string
          payment_reference: string
          payment_status: string
          replay_generation: number
          tenant_id: string
        }
        Insert: {
          branch_id: string
          currency_code?: string
          finalized_at?: string | null
          id?: string
          idempotency_key: string
          initiated_at?: string
          order_id: string
          payment_amount_minor: number
          payment_provider: string
          payment_reference: string
          payment_status: string
          replay_generation?: number
          tenant_id: string
        }
        Update: {
          branch_id?: string
          currency_code?: string
          finalized_at?: string | null
          id?: string
          idempotency_key?: string
          initiated_at?: string
          order_id?: string
          payment_amount_minor?: number
          payment_provider?: string
          payment_reference?: string
          payment_status?: string
          replay_generation?: number
          tenant_id?: string
        }
        Relationships: []
      }
      payment_records: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          paid_at: string
          payment_method: string | null
          payment_note: string | null
          payment_reference: string | null
          period_end: string | null
          period_start: string | null
          recorded_by: string | null
          tenant_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          paid_at: string
          payment_method?: string | null
          payment_note?: string | null
          payment_reference?: string | null
          period_end?: string | null
          period_start?: string | null
          recorded_by?: string | null
          tenant_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          paid_at?: string
          payment_method?: string | null
          payment_note?: string | null
          payment_reference?: string | null
          period_end?: string | null
          period_start?: string | null
          recorded_by?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_minor: number
          branch_id: string
          created_at: string
          currency_code: string
          gateway_payload: Json | null
          gateway_ref: string | null
          id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          settlement_id: string
          status: Database["public"]["Enums"]["payment_status"]
          tenant_id: string
        }
        Insert: {
          amount_minor: number
          branch_id: string
          created_at?: string
          currency_code?: string
          gateway_payload?: Json | null
          gateway_ref?: string | null
          id?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          settlement_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          tenant_id: string
        }
        Update: {
          amount_minor?: number
          branch_id?: string
          created_at?: string
          currency_code?: string
          gateway_payload?: Json | null
          gateway_ref?: string | null
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          settlement_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          key: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          id?: string
          key: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      pin_attempts: {
        Row: {
          attempted_at: string
          device_key: string
          id: string
          tenant_id: string
        }
        Insert: {
          attempted_at?: string
          device_key: string
          id?: string
          tenant_id: string
        }
        Update: {
          attempted_at?: string
          device_key?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pin_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_features: {
        Row: {
          feature_key: string
          id: string
          is_enabled: boolean | null
          limit_value: number | null
          plan: string
        }
        Insert: {
          feature_key: string
          id?: string
          is_enabled?: boolean | null
          limit_value?: number | null
          plan: string
        }
        Update: {
          feature_key?: string
          id?: string
          is_enabled?: boolean | null
          limit_value?: number | null
          plan?: string
        }
        Relationships: []
      }
      platform_users: {
        Row: {
          created_at: string
          deleted_at: string | null
          email: string
          full_name: string
          id: string
          is_super_admin: boolean
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email: string
          full_name: string
          id: string
          is_super_admin?: boolean
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_super_admin?: boolean
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auth_id: string
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          phone: string | null
          preferences: Json
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          auth_id: string
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          phone?: string | null
          preferences?: Json
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          auth_id?: string
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          preferences?: Json
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      projection_audit_logs: {
        Row: {
          branch_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          projection_id: string
          projection_revision: number | null
          projection_type: string
          reason: string | null
          source_mutation_id: string | null
          source_revision: number | null
          tenant_id: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          projection_id: string
          projection_revision?: number | null
          projection_type: string
          reason?: string | null
          source_mutation_id?: string | null
          source_revision?: number | null
          tenant_id?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          projection_id?: string
          projection_revision?: number | null
          projection_type?: string
          reason?: string | null
          source_mutation_id?: string | null
          source_revision?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projection_audit_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projection_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      projection_schema_registry: {
        Row: {
          id: string
          is_compatible: boolean
          last_validated_at: string
          projection_name: string
          projection_version: number
          rebuild_generation: number
          snapshot_version: number
        }
        Insert: {
          id?: string
          is_compatible?: boolean
          last_validated_at?: string
          projection_name: string
          projection_version?: number
          rebuild_generation?: number
          snapshot_version?: number
        }
        Update: {
          id?: string
          is_compatible?: boolean
          last_validated_at?: string
          projection_name?: string
          projection_version?: number
          rebuild_generation?: number
          snapshot_version?: number
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          current_uses: number
          description: string
          discount_type: string
          discount_value_minor: number
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          current_uses?: number
          description: string
          discount_type: string
          discount_value_minor: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          current_uses?: number
          description?: string
          discount_type?: string
          discount_value_minor?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_codes: {
        Row: {
          branch_id: string
          code_slug: string
          generated_at: string
          generated_by: string | null
          id: string
          invalidated_at: string | null
          invalidated_by: string | null
          is_active: boolean
          signed_payload: string
          table_id: string
          tenant_id: string
        }
        Insert: {
          branch_id: string
          code_slug: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          is_active?: boolean
          signed_payload: string
          table_id: string
          tenant_id: string
        }
        Update: {
          branch_id?: string
          code_slug?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          invalidated_at?: string | null
          invalidated_by?: string | null
          is_active?: boolean
          signed_payload?: string
          table_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_codes_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_scan_nonces: {
        Row: {
          client_ip: string | null
          id: string
          nonce: string
          qr_code_id: string
          tenant_id: string
          used_at: string
          user_agent: string | null
        }
        Insert: {
          client_ip?: string | null
          id?: string
          nonce: string
          qr_code_id: string
          tenant_id: string
          used_at?: string
          user_agent?: string | null
        }
        Update: {
          client_ip?: string | null
          id?: string
          nonce?: string
          qr_code_id?: string
          tenant_id?: string
          used_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_scan_nonces_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_sessions: {
        Row: {
          branch_id: string
          cart_revision: number
          client_ip: string | null
          closed_at: string | null
          created_at: string
          device_fingerprint: string | null
          expires_at: string | null
          id: string
          last_activity_at: string
          nonce_id: string | null
          qr_code_id: string | null
          session_token: string
          source: string
          status: string
          table_id: string | null
          tenant_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          branch_id: string
          cart_revision?: number
          client_ip?: string | null
          closed_at?: string | null
          created_at?: string
          device_fingerprint?: string | null
          expires_at?: string | null
          id?: string
          last_activity_at?: string
          nonce_id?: string | null
          qr_code_id?: string | null
          session_token: string
          source?: string
          status?: string
          table_id?: string | null
          tenant_id: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          branch_id?: string
          cart_revision?: number
          client_ip?: string | null
          closed_at?: string | null
          created_at?: string
          device_fingerprint?: string | null
          expires_at?: string | null
          id?: string
          last_activity_at?: string
          nonce_id?: string | null
          qr_code_id?: string | null
          session_token?: string
          source?: string
          status?: string
          table_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_sessions_nonce_id_fkey"
            columns: ["nonce_id"]
            isOneToOne: false
            referencedRelation: "qr_scan_nonces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_sessions_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_metrics: {
        Row: {
          created_at: string
          dlq_count: number
          failed_count: number
          id: string
          oldest_pending_age_sec: number
          partition_key: string
          pending_count: number
        }
        Insert: {
          created_at?: string
          dlq_count: number
          failed_count: number
          id?: string
          oldest_pending_age_sec: number
          partition_key: string
          pending_count: number
        }
        Update: {
          created_at?: string
          dlq_count?: number
          failed_count?: number
          id?: string
          oldest_pending_age_sec?: number
          partition_key?: string
          pending_count?: number
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          expires_at: string
          key: string
          last_refilled_at: string
          tokens: number
        }
        Insert: {
          expires_at: string
          key: string
          last_refilled_at: string
          tokens: number
        }
        Update: {
          expires_at?: string
          key?: string
          last_refilled_at?: string
          tokens?: number
        }
        Relationships: []
      }
      receipt_snapshots: {
        Row: {
          bill_id: string
          branch_id: string
          created_at: string
          frozen_payload: Json
          id: string
          receipt_number: string
          tenant_id: string
        }
        Insert: {
          bill_id: string
          branch_id: string
          created_at?: string
          frozen_payload: Json
          id?: string
          receipt_number: string
          tenant_id: string
        }
        Update: {
          bill_id?: string
          branch_id?: string
          created_at?: string
          frozen_payload?: Json
          id?: string
          receipt_number?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_snapshots_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: true
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_metrics: {
        Row: {
          carts_reclaimed: number
          created_at: string
          execution_time_ms: number
          id: string
          idempotency_keys_freed: number
          job_name: string
          kitchen_tickets_synced: number
          orders_reconciled: number
        }
        Insert: {
          carts_reclaimed?: number
          created_at?: string
          execution_time_ms: number
          id?: string
          idempotency_keys_freed?: number
          job_name: string
          kitchen_tickets_synced?: number
          orders_reconciled?: number
        }
        Update: {
          carts_reclaimed?: number
          created_at?: string
          execution_time_ms?: number
          id?: string
          idempotency_keys_freed?: number
          job_name?: string
          kitchen_tickets_synced?: number
          orders_reconciled?: number
        }
        Relationships: []
      }
      recovery_jobs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          job_type: string
          parameters: Json
          result_summary: Json | null
          started_at: string
          started_by: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          job_type: string
          parameters?: Json
          result_summary?: Json | null
          started_at?: string
          started_by?: string | null
          status: string
          tenant_id?: string | null
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          job_type?: string
          parameters?: Json
          result_summary?: Json | null
          started_at?: string
          started_by?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recovery_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          bill_id: string
          branch_id: string
          created_at: string
          currency_code: string
          gateway_ref: string | null
          id: string
          idempotency_key: string | null
          issued_by: string | null
          payment_transaction_id: string | null
          reason: string
          refund_amount_minor: number
          tenant_id: string
        }
        Insert: {
          bill_id: string
          branch_id: string
          created_at?: string
          currency_code?: string
          gateway_ref?: string | null
          id?: string
          idempotency_key?: string | null
          issued_by?: string | null
          payment_transaction_id?: string | null
          reason: string
          refund_amount_minor: number
          tenant_id: string
        }
        Update: {
          bill_id?: string
          branch_id?: string
          created_at?: string
          currency_code?: string
          gateway_ref?: string | null
          id?: string
          idempotency_key?: string | null
          issued_by?: string | null
          payment_transaction_id?: string | null
          reason?: string
          refund_amount_minor?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      replay_metrics: {
        Row: {
          created_at: string
          diff_payload: Json | null
          event_id: string
          id: string
          is_dry_run: boolean
          replay_reason: string | null
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          diff_payload?: Json | null
          event_id: string
          id?: string
          is_dry_run?: boolean
          replay_reason?: string | null
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          diff_payload?: Json | null
          event_id?: string
          id?: string
          is_dry_run?: boolean
          replay_reason?: string | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      restaurant_settings: {
        Row: {
          branding: Json
          business_address: string | null
          business_email: string | null
          business_name: string
          business_phone: string | null
          created_at: string
          currency_code: string
          features_enabled: Json
          id: string
          locale: string
          operating_hours: Json
          tax_registration_number: string | null
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          branding?: Json
          business_address?: string | null
          business_email?: string | null
          business_name: string
          business_phone?: string | null
          created_at?: string
          currency_code?: string
          features_enabled?: Json
          id?: string
          locale?: string
          operating_hours?: Json
          tax_registration_number?: string | null
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          branding?: Json
          business_address?: string | null
          business_email?: string | null
          business_name?: string
          business_phone?: string | null
          created_at?: string
          currency_code?: string
          features_enabled?: Json
          id?: string
          locale?: string
          operating_hours?: Json
          tax_registration_number?: string | null
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          capacity: number | null
          created_at: string | null
          floor: number | null
          id: string
          status: string | null
          table_num: string
          tenant_id: string | null
        }
        Insert: {
          capacity?: number | null
          created_at?: string | null
          floor?: number | null
          id?: string
          status?: string | null
          table_num: string
          tenant_id?: string | null
        }
        Update: {
          capacity?: number | null
          created_at?: string | null
          floor?: number | null
          id?: string
          status?: string | null
          table_num?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          branch_id: string
          comment: string | null
          created_at: string
          food_rating: number | null
          guest_session_id: string | null
          id: string
          is_flagged: boolean | null
          order_id: string
          phone: string | null
          rating: number
          service_rating: number | null
          staff_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          comment?: string | null
          created_at?: string
          food_rating?: number | null
          guest_session_id?: string | null
          id?: string
          is_flagged?: boolean | null
          order_id: string
          phone?: string | null
          rating: number
          service_rating?: number | null
          staff_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          comment?: string | null
          created_at?: string
          food_rating?: number | null
          guest_session_id?: string | null
          id?: string
          is_flagged?: boolean | null
          order_id?: string
          phone?: string | null
          rating?: number
          service_rating?: number | null
          staff_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_guest_session_id_fkey"
            columns: ["guest_session_id"]
            isOneToOne: false
            referencedRelation: "guest_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_key: string
          role: Database["public"]["Enums"]["rbac_role"]
        }
        Insert: {
          created_at?: string
          id?: string
          permission_key: string
          role: Database["public"]["Enums"]["rbac_role"]
        }
        Update: {
          created_at?: string
          id?: string
          permission_key?: string
          role?: Database["public"]["Enums"]["rbac_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      runtime_capacity_metrics: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          queue_pressure: number
          rebuild_pressure: number
          replay_saturation: number
          replay_throughput: number
          tenant_id: string
          websocket_load: number
          worker_utilization: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          queue_pressure?: number
          rebuild_pressure?: number
          replay_saturation?: number
          replay_throughput?: number
          tenant_id: string
          websocket_load?: number
          worker_utilization?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          queue_pressure?: number
          rebuild_pressure?: number
          replay_saturation?: number
          replay_throughput?: number
          tenant_id?: string
          websocket_load?: number
          worker_utilization?: number
        }
        Relationships: []
      }
      runtime_convergence_metrics: {
        Row: {
          branch_id: string
          convergence_latency_ms: number
          created_at: string
          drift_frequency: number
          id: string
          reconnect_count: number
          replay_lag_ms: number
          surface_id: string | null
          tenant_id: string
          throughput_events_per_sec: number
        }
        Insert: {
          branch_id: string
          convergence_latency_ms?: number
          created_at?: string
          drift_frequency?: number
          id?: string
          reconnect_count?: number
          replay_lag_ms?: number
          surface_id?: string | null
          tenant_id: string
          throughput_events_per_sec?: number
        }
        Update: {
          branch_id?: string
          convergence_latency_ms?: number
          created_at?: string
          drift_frequency?: number
          id?: string
          reconnect_count?: number
          replay_lag_ms?: number
          surface_id?: string | null
          tenant_id?: string
          throughput_events_per_sec?: number
        }
        Relationships: [
          {
            foreignKeyName: "runtime_convergence_metrics_surface_id_fkey"
            columns: ["surface_id"]
            isOneToOne: false
            referencedRelation: "runtime_surface_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_cost_metrics: {
        Row: {
          branch_id: string
          created_at: string
          db_query_cost_microcents: number
          id: string
          ledger_growth_bytes: number
          rebuild_cost_microcents: number
          replay_bandwidth_bytes: number
          telemetry_growth_bytes: number
          tenant_id: string
          websocket_usage_count: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          db_query_cost_microcents?: number
          id?: string
          ledger_growth_bytes?: number
          rebuild_cost_microcents?: number
          replay_bandwidth_bytes?: number
          telemetry_growth_bytes?: number
          tenant_id: string
          websocket_usage_count?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          db_query_cost_microcents?: number
          id?: string
          ledger_growth_bytes?: number
          rebuild_cost_microcents?: number
          replay_bandwidth_bytes?: number
          telemetry_growth_bytes?: number
          tenant_id?: string
          websocket_usage_count?: number
        }
        Relationships: []
      }
      runtime_event_ledger: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          branch_id: string
          causation_id: string | null
          correlation_id: string | null
          emitted_at: string
          emitted_by: string
          event_payload_json: Json
          event_type: string
          event_version: number
          global_sequence: number
          id: string
          projection_generation: string
          tenant_id: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          branch_id: string
          causation_id?: string | null
          correlation_id?: string | null
          emitted_at?: string
          emitted_by: string
          event_payload_json: Json
          event_type: string
          event_version?: number
          global_sequence?: number
          id?: string
          projection_generation?: string
          tenant_id: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          branch_id?: string
          causation_id?: string | null
          correlation_id?: string | null
          emitted_at?: string
          emitted_by?: string
          event_payload_json?: Json
          event_type?: string
          event_version?: number
          global_sequence?: number
          id?: string
          projection_generation?: string
          tenant_id?: string
        }
        Relationships: []
      }
      runtime_incidents: {
        Row: {
          branch_id: string
          created_at: string
          details: Json
          id: string
          incident_type: string
          message: string
          resolved: boolean
          resolved_at: string | null
          severity: string
          tenant_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          details?: Json
          id?: string
          incident_type: string
          message: string
          resolved?: boolean
          resolved_at?: string | null
          severity: string
          tenant_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          details?: Json
          id?: string
          incident_type?: string
          message?: string
          resolved?: boolean
          resolved_at?: string | null
          severity?: string
          tenant_id?: string
        }
        Relationships: []
      }
      runtime_projection_ownership: {
        Row: {
          branch_id: string
          expires_at: string
          leased_at: string
          owner_worker_id: string
          projection_name: string
          tenant_id: string
        }
        Insert: {
          branch_id: string
          expires_at: string
          leased_at?: string
          owner_worker_id: string
          projection_name: string
          tenant_id: string
        }
        Update: {
          branch_id?: string
          expires_at?: string
          leased_at?: string
          owner_worker_id?: string
          projection_name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "runtime_projection_ownership_owner_worker_id_fkey"
            columns: ["owner_worker_id"]
            isOneToOne: false
            referencedRelation: "runtime_worker_registry"
            referencedColumns: ["worker_id"]
          },
        ]
      }
      runtime_replay_checkpoints: {
        Row: {
          branch_id: string
          checksum: string
          id: string
          last_sequence: number
          projection_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          checksum: string
          id?: string
          last_sequence?: number
          projection_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          checksum?: string
          id?: string
          last_sequence?: number
          projection_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      runtime_replay_fences: {
        Row: {
          active_deployment_id: string
          branch_id: string
          compatibility_window: string
          created_at: string
          expires_at: string
          id: string
          projection_generation: number
          replay_epoch: string
          tenant_id: string
        }
        Insert: {
          active_deployment_id: string
          branch_id: string
          compatibility_window?: string
          created_at?: string
          expires_at: string
          id?: string
          projection_generation?: number
          replay_epoch?: string
          tenant_id: string
        }
        Update: {
          active_deployment_id?: string
          branch_id?: string
          compatibility_window?: string
          created_at?: string
          expires_at?: string
          id?: string
          projection_generation?: number
          replay_epoch?: string
          tenant_id?: string
        }
        Relationships: []
      }
      runtime_surface_identities: {
        Row: {
          active_projection_generation: number
          branch_id: string
          deployment_compatibility: string
          id: string
          last_seen_at: string
          reconnect_state: string
          replay_epoch: string
          runtime_generation: number
          surface_type: string
          tenant_id: string
        }
        Insert: {
          active_projection_generation?: number
          branch_id: string
          deployment_compatibility?: string
          id?: string
          last_seen_at?: string
          reconnect_state?: string
          replay_epoch?: string
          runtime_generation?: number
          surface_type: string
          tenant_id: string
        }
        Update: {
          active_projection_generation?: number
          branch_id?: string
          deployment_compatibility?: string
          id?: string
          last_seen_at?: string
          reconnect_state?: string
          replay_epoch?: string
          runtime_generation?: number
          surface_type?: string
          tenant_id?: string
        }
        Relationships: []
      }
      runtime_worker_registry: {
        Row: {
          branch_id: string
          created_at: string
          deployment_version: string
          heartbeat_status: string
          id: string
          last_heartbeat: string
          projection_ownership: Json
          reconnect_load: number
          replay_ownership: Json
          tenant_id: string
          worker_id: string
          worker_role: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          deployment_version: string
          heartbeat_status?: string
          id?: string
          last_heartbeat?: string
          projection_ownership?: Json
          reconnect_load?: number
          replay_ownership?: Json
          tenant_id: string
          worker_id: string
          worker_role: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          deployment_version?: string
          heartbeat_status?: string
          id?: string
          last_heartbeat?: string
          projection_ownership?: Json
          reconnect_load?: number
          replay_ownership?: Json
          tenant_id?: string
          worker_id?: string
          worker_role?: string
        }
        Relationships: []
      }
      settlement_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          error_message: string | null
          gateway_reference: string | null
          id: string
          payment_intent_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempt_number?: number
          created_at?: string
          error_message?: string | null
          gateway_reference?: string | null
          id?: string
          payment_intent_id: string
          status: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          error_message?: string | null
          gateway_reference?: string | null
          id?: string
          payment_intent_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_attempts_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount_minor: number
          bill_id: string
          branch_id: string
          created_at: string
          currency_code: string
          id: string
          payment_intent_id: string | null
          processed_by: string | null
          settled_at: string
          tenant_id: string
        }
        Insert: {
          amount_minor: number
          bill_id: string
          branch_id: string
          created_at?: string
          currency_code?: string
          id?: string
          payment_intent_id?: string | null
          processed_by?: string | null
          settled_at?: string
          tenant_id: string
        }
        Update: {
          amount_minor?: number
          bill_id?: string
          branch_id?: string
          created_at?: string
          currency_code?: string
          id?: string
          payment_intent_id?: string | null
          processed_by?: string | null
          settled_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      split_allocations: {
        Row: {
          allocated_percentage: number | null
          allocated_quantity: number | null
          amount_minor: number
          bill_id: string
          bill_item_id: string | null
          created_at: string
          id: string
          split_bill_id: string
          tenant_id: string
        }
        Insert: {
          allocated_percentage?: number | null
          allocated_quantity?: number | null
          amount_minor: number
          bill_id: string
          bill_item_id?: string | null
          created_at?: string
          id?: string
          split_bill_id: string
          tenant_id: string
        }
        Update: {
          allocated_percentage?: number | null
          allocated_quantity?: number | null
          amount_minor?: number
          bill_id?: string
          bill_item_id?: string | null
          created_at?: string
          id?: string
          split_bill_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "split_allocations_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "split_allocations_bill_item_id_fkey"
            columns: ["bill_item_id"]
            isOneToOne: false
            referencedRelation: "bill_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "split_allocations_split_bill_id_fkey"
            columns: ["split_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          address: string | null
          age: number | null
          auth_type: string
          blood_group: string | null
          branch_id: string | null
          created_at: string | null
          department: string | null
          developer_mode_enabled: boolean
          dob: string | null
          email: string | null
          emergency_contact: string | null
          emergency_contact_name: string | null
          emergency_contact_number: string | null
          employee_id: string | null
          employment_status: string | null
          first_name: string | null
          gender: string | null
          id: string
          is_active: boolean | null
          joining_date: string | null
          last_name: string | null
          mobile_number: string | null
          name: string
          nationality: string | null
          notes: string | null
          pin: string | null
          profile_completed: boolean | null
          profile_completed_at: string | null
          profile_photo: string | null
          profile_setup_step: number | null
          role: string | null
          shift_information: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          age?: number | null
          auth_type?: string
          blood_group?: string | null
          branch_id?: string | null
          created_at?: string | null
          department?: string | null
          developer_mode_enabled?: boolean
          dob?: string | null
          email?: string | null
          emergency_contact?: string | null
          emergency_contact_name?: string | null
          emergency_contact_number?: string | null
          employee_id?: string | null
          employment_status?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          joining_date?: string | null
          last_name?: string | null
          mobile_number?: string | null
          name: string
          nationality?: string | null
          notes?: string | null
          pin?: string | null
          profile_completed?: boolean | null
          profile_completed_at?: string | null
          profile_photo?: string | null
          profile_setup_step?: number | null
          role?: string | null
          shift_information?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          age?: number | null
          auth_type?: string
          blood_group?: string | null
          branch_id?: string | null
          created_at?: string | null
          department?: string | null
          developer_mode_enabled?: boolean
          dob?: string | null
          email?: string | null
          emergency_contact?: string | null
          emergency_contact_name?: string | null
          emergency_contact_number?: string | null
          employee_id?: string | null
          employment_status?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          joining_date?: string | null
          last_name?: string | null
          mobile_number?: string | null
          name?: string
          nationality?: string | null
          notes?: string | null
          pin?: string | null
          profile_completed?: boolean | null
          profile_completed_at?: string | null
          profile_photo?: string | null
          profile_setup_step?: number | null
          role?: string | null
          shift_information?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      table_floors: {
        Row: {
          branch_id: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
          version_num: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          version_num?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          version_num?: number
        }
        Relationships: []
      }
      table_qr_tokens: {
        Row: {
          access_count: number
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          last_accessed_at: string | null
          last_ip_hash: string | null
          public_token: string
          revoked_at: string | null
          rotated_at: string | null
          suspicious_access_count: number
          table_id: string
          tenant_id: string
          user_agent_hash: string | null
        }
        Insert: {
          access_count?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_accessed_at?: string | null
          last_ip_hash?: string | null
          public_token: string
          revoked_at?: string | null
          rotated_at?: string | null
          suspicious_access_count?: number
          table_id: string
          tenant_id: string
          user_agent_hash?: string | null
        }
        Update: {
          access_count?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_accessed_at?: string | null
          last_ip_hash?: string | null
          public_token?: string
          revoked_at?: string | null
          rotated_at?: string | null
          suspicious_access_count?: number
          table_id?: string
          tenant_id?: string
          user_agent_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_qr_tokens_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_reservations: {
        Row: {
          branch_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          customer_name: string
          customer_phone: string | null
          deleted_at: string | null
          id: string
          notes: string | null
          party_size: number
          reserved_at: string
          seated_at: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          table_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          branch_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_name: string
          customer_phone?: string | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          party_size: number
          reserved_at: string
          seated_at?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          table_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          branch_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string
          customer_phone?: string | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          party_size?: number
          reserved_at?: string
          seated_at?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          table_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "table_reservations_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_runtime_projections: {
        Row: {
          active_guest_count: number
          active_order_count: number
          assistance_request_count: number
          runtime_state: string
          table_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active_guest_count?: number
          active_order_count?: number
          assistance_request_count?: number
          runtime_state?: string
          table_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active_guest_count?: number
          active_order_count?: number
          assistance_request_count?: number
          runtime_state?: string
          table_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_runtime_projections_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: true
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sections: {
        Row: {
          branch_id: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
          version_num: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          version_num?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          version_num?: number
        }
        Relationships: []
      }
      table_state_history: {
        Row: {
          branch_id: string
          changed_by: string | null
          id: string
          metadata: Json
          occurred_at: string
          reason: string | null
          table_id: string
          tenant_id: string
        }
        Insert: {
          branch_id: string
          changed_by?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          reason?: string | null
          table_id: string
          tenant_id: string
        }
        Update: {
          branch_id?: string
          changed_by?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          reason?: string | null
          table_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_state_history_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          assigned_staff_id: string | null
          branch_id: string
          capacity: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          display_name: string | null
          floor_id: string | null
          id: string
          is_active: boolean
          notes: string | null
          qr_code_id: string | null
          qr_token: string | null
          qr_url: string | null
          section_id: string | null
          sequence_num: number | null
          sort_order: number
          table_number: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          assigned_staff_id?: string | null
          branch_id: string
          capacity?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name?: string | null
          floor_id?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          qr_code_id?: string | null
          qr_token?: string | null
          qr_url?: string | null
          section_id?: string | null
          sequence_num?: number | null
          sort_order?: number
          table_number: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          assigned_staff_id?: string | null
          branch_id?: string
          capacity?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name?: string | null
          floor_id?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          qr_code_id?: string | null
          qr_token?: string | null
          qr_url?: string | null
          section_id?: string | null
          sequence_num?: number | null
          sort_order?: number
          table_number?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "tables_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "table_floors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_qr_code_id_fk"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "table_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_profiles: {
        Row: {
          calculation_mode: Database["public"]["Enums"]["tax_calculation_mode"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          priority: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          calculation_mode?: Database["public"]["Enums"]["tax_calculation_mode"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          calculation_mode?: Database["public"]["Enums"]["tax_calculation_mode"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          name: string
          priority: number
          rate_basis_points: number
          tax_profile_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version_num: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          rate_basis_points: number
          tax_profile_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          rate_basis_points?: number
          tax_profile_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rates_tax_profile_id_fkey"
            columns: ["tax_profile_id"]
            isOneToOne: false
            referencedRelation: "tax_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_users: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          role: Database["public"]["Enums"]["admin_role"]
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["admin_role"]
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["admin_role"]
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          activated_at: string | null
          billing_cycle: string | null
          brand_accent: string | null
          brand_primary: string | null
          created_at: string | null
          dev_temp_password: string | null
          dev_temp_password_set_at: string | null
          dismissed_qr_banner: boolean
          id: string
          is_active: boolean
          last_payment_amount: number | null
          last_payment_date: string | null
          last_payment_method: string | null
          last_payment_reference: string | null
          location: string | null
          mrr: number | null
          name: string
          next_billing_date: string | null
          onboarded_by: string | null
          onboarding_complete: boolean
          owner_email: string | null
          owner_name: string | null
          owner_phone: string | null
          owner_user_id: string | null
          plan: string | null
          plan_amount: number | null
          plan_started_at: string | null
          restaurant_code: string
          slug: string
          status: string | null
          suspended_at: string | null
          updated_at: string | null
        }
        Insert: {
          activated_at?: string | null
          billing_cycle?: string | null
          brand_accent?: string | null
          brand_primary?: string | null
          created_at?: string | null
          dev_temp_password?: string | null
          dev_temp_password_set_at?: string | null
          dismissed_qr_banner?: boolean
          id?: string
          is_active?: boolean
          last_payment_amount?: number | null
          last_payment_date?: string | null
          last_payment_method?: string | null
          last_payment_reference?: string | null
          location?: string | null
          mrr?: number | null
          name: string
          next_billing_date?: string | null
          onboarded_by?: string | null
          onboarding_complete?: boolean
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          owner_user_id?: string | null
          plan?: string | null
          plan_amount?: number | null
          plan_started_at?: string | null
          restaurant_code: string
          slug: string
          status?: string | null
          suspended_at?: string | null
          updated_at?: string | null
        }
        Update: {
          activated_at?: string | null
          billing_cycle?: string | null
          brand_accent?: string | null
          brand_primary?: string | null
          created_at?: string | null
          dev_temp_password?: string | null
          dev_temp_password_set_at?: string | null
          dismissed_qr_banner?: boolean
          id?: string
          is_active?: boolean
          last_payment_amount?: number | null
          last_payment_date?: string | null
          last_payment_method?: string | null
          last_payment_reference?: string | null
          location?: string | null
          mrr?: number | null
          name?: string
          next_billing_date?: string | null
          onboarded_by?: string | null
          onboarding_complete?: boolean
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          owner_user_id?: string | null
          plan?: string | null
          plan_amount?: number | null
          plan_started_at?: string | null
          restaurant_code?: string
          slug?: string
          status?: string | null
          suspended_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      transport_audit_logs: {
        Row: {
          branch_id: string | null
          connection_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          reason: string | null
          session_id: string | null
          stream_instance_id: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          branch_id?: string | null
          connection_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          session_id?: string | null
          stream_instance_id: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          branch_id?: string | null
          connection_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          session_id?: string | null
          stream_instance_id?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transport_audit_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permission_overrides: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          is_grant: boolean
          permission_key: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          is_grant: boolean
          permission_key: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          is_grant?: boolean
          permission_key?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "user_permission_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          is_active: boolean
          revoked_at: string | null
          role: Database["public"]["Enums"]["rbac_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          revoked_at?: string | null
          role: Database["public"]["Enums"]["rbac_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["rbac_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_id: string
          branch_ids: string[]
          created_at: string
          email: string
          id: string
          is_first_login: boolean
          role: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          auth_id: string
          branch_ids?: string[]
          created_at?: string
          email: string
          id?: string
          is_first_login?: boolean
          role?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          auth_id?: string
          branch_ids?: string[]
          created_at?: string
          email?: string
          id?: string
          is_first_login?: boolean
          role?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      waiter_calls: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          branch_id: string
          created_at: string
          deleted_at: string | null
          id: string
          notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          session_id: string | null
          status: string
          table_id: string
          tenant_id: string
          type: string
          updated_at: string
          version_num: number
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          branch_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          status?: string
          table_id: string
          tenant_id: string
          type: string
          updated_at?: string
          version_num?: number
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          branch_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          status?: string
          table_id?: string
          tenant_id?: string
          type?: string
          updated_at?: string
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "waiter_calls_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_heartbeats: {
        Row: {
          id: string
          last_heartbeat_at: string
          status: string
          worker_name: string
        }
        Insert: {
          id?: string
          last_heartbeat_at?: string
          status?: string
          worker_name: string
        }
        Update: {
          id?: string
          last_heartbeat_at?: string
          status?: string
          worker_name?: string
        }
        Relationships: []
      }
      worker_leases: {
        Row: {
          id: string
          lease_acquired_at: string
          lease_expires_at: string
          node_id: string
          status: string
          version_num: number
          worker_name: string
        }
        Insert: {
          id?: string
          lease_acquired_at?: string
          lease_expires_at: string
          node_id: string
          status?: string
          version_num?: number
          worker_name: string
        }
        Update: {
          id?: string
          lease_acquired_at?: string
          lease_expires_at?: string
          node_id?: string
          status?: string
          version_num?: number
          worker_name?: string
        }
        Relationships: []
      }
      worker_metrics: {
        Row: {
          created_at: string
          error_reason: string | null
          event_id: string | null
          event_type: string
          execution_time_ms: number
          id: string
          partition_key: string
          status: string
          worker_name: string
        }
        Insert: {
          created_at?: string
          error_reason?: string | null
          event_id?: string | null
          event_type: string
          execution_time_ms: number
          id?: string
          partition_key: string
          status: string
          worker_name: string
        }
        Update: {
          created_at?: string
          error_reason?: string | null
          event_id?: string | null
          event_type?: string
          execution_time_ms?: number
          id?: string
          partition_key?: string
          status?: string
          worker_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      mrr_monthly: {
        Row: {
          cumulative_mrr: number | null
          label: string | null
          month_date: string | null
          new_mrr: number | null
        }
        Relationships: []
      }
      v_user_effective_roles: {
        Row: {
          email: string | null
          granted_at: string | null
          id: string | null
          is_active: boolean | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["rbac_role"] | null
          tenant_id: string | null
          tenant_name: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      allocate_next_sequence: {
        Args: {
          p_branch_id: string
          p_daily_reset: boolean
          p_sequence_type: string
          p_tenant_id: string
        }
        Returns: number
      }
      assign_role:
        | {
            Args: {
              p_granted_by: string
              p_role: Database["public"]["Enums"]["admin_role"]
              p_tenant_id: string
              p_user_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_granted_by: string
              p_role: Database["public"]["Enums"]["rbac_role"]
              p_tenant_id: string
              p_user_id: string
            }
            Returns: {
              granted_at: string
              granted_by: string | null
              id: string
              is_active: boolean
              revoked_at: string | null
              role: Database["public"]["Enums"]["rbac_role"]
              tenant_id: string | null
              user_id: string
            }
            SetofOptions: {
              from: "*"
              to: "user_roles"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      auth_tenant_id: { Args: never; Returns: string }
      check_permission: {
        Args: {
          p_permission_key: string
          p_tenant_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      check_rate_limit_raw: {
        Args: {
          p_capacity: number
          p_key: string
          p_refill_rate: number
          p_window_sec: number
        }
        Returns: {
          allowed: boolean
          remaining: number
        }[]
      }
      claim_next_outbox_event:
        | {
            Args: { p_lock_duration_sec: number; p_worker_name: string }
            Returns: {
              aggregate_id: string
              aggregate_type: string
              branch_id: string | null
              delivery_status: string
              error_reason: string | null
              event_type: string
              id: string
              last_attempt_at: string | null
              locked_by: string | null
              locked_until: string | null
              occurred_at: string
              partition_key: string
              payload: Json
              retry_count: number
              sequence_num: number
              tenant_id: string
            }[]
            SetofOptions: {
              from: "*"
              to: "domain_events"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_lock_duration_sec: number
              p_partition_key: string
              p_worker_name: string
            }
            Returns: {
              aggregate_id: string
              aggregate_type: string
              branch_id: string | null
              delivery_status: string
              error_reason: string | null
              event_type: string
              id: string
              last_attempt_at: string | null
              locked_by: string | null
              locked_until: string | null
              occurred_at: string
              partition_key: string
              payload: Json
              retry_count: number
              sequence_num: number
              tenant_id: string
            }[]
            SetofOptions: {
              from: "*"
              to: "domain_events"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      clean_old_pin_attempts: { Args: never; Returns: undefined }
      cleanup_expired_rate_limits: { Args: never; Returns: undefined }
      current_branch_ids: { Args: never; Returns: string[] }
      current_tenant_id: { Args: never; Returns: string }
      current_user_id: { Args: never; Returns: string }
      get_active_outbox_partitions: {
        Args: never
        Returns: {
          partition_key: string
          pending_count: number
        }[]
      }
      get_admin_profile_by_email: {
        Args: { p_email: string }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          failed_login_count: number
          full_name: string
          id: string
          is_active: boolean
          is_locked: boolean
          last_login_at: string | null
          last_login_ip: unknown
          lock_reason: string | null
          locked_until: string | null
          must_change_password: boolean
          phone: string | null
          role: Database["public"]["Enums"]["admin_role"]
          tenant_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_bootstrap_context: { Args: { p_tenant_id: string }; Returns: Json }
      get_my_admin_profile: {
        Args: never
        Returns: {
          full_name: string
          id: string
          is_active: boolean
          is_locked: boolean
          last_login_at: string
          locked_until: string
          must_change_password: boolean
          role: Database["public"]["Enums"]["admin_role"]
          tenant_id: string
        }[]
      }
      get_next_aggregate_sequence: {
        Args: { p_branch_id: string; p_table_name: string; p_tenant_id: string }
        Returns: number
      }
      get_onboarding_status: { Args: { p_tenant_id: string }; Returns: Json }
      get_orders_daily: {
        Args: { p_tenant_id: string }
        Returns: {
          day_date: string
          label: string
          order_count: number
          revenue: number
        }[]
      }
      get_orders_hourly: {
        Args: { p_tenant_id: string }
        Returns: {
          hour_time: string
          label: string
          order_count: number
          revenue: number
        }[]
      }
      get_user_permissions: {
        Args: { p_tenant_id?: string; p_user_id: string }
        Returns: {
          permission_key: string
        }[]
      }
      increment_failed_login_count: {
        Args: { p_user_id: string }
        Returns: number
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      is_tenant_menu_admin: { Args: never; Returns: boolean }
      log_branch_operational_event: {
        Args: {
          p_aggregate_id: string
          p_aggregate_type: string
          p_branch_id: string
          p_event_type: string
          p_payload: Json
          p_tenant_id: string
        }
        Returns: number
      }
      log_financial_event: {
        Args: {
          p_aggregate_id: string
          p_aggregate_type: string
          p_branch_id: string
          p_event_type: string
          p_payload: Json
          p_tenant_id: string
        }
        Returns: number
      }
      orchestrate_append_checkout_v1: {
        Args: {
          p_cart_id: string
          p_existing_order_id: string
          p_idempotency_key: string
          p_order_notes: string
          p_round2_snapshot_id: string
          p_tenant_id: string
          p_user_id: string
        }
        Returns: Json
      }
      orchestrate_checkout_v1: {
        Args: {
          p_cart_id: string
          p_idempotency_key: string
          p_invoice_id: string
          p_invoice_number: string
          p_order_id: string
          p_order_notes: string
          p_order_number: string
          p_session_id: string
          p_snapshot_id: string
          p_source: string
          p_table_id: string
          p_tenant_id: string
          p_user_id: string
        }
        Returns: Json
      }
      prune_operational_metrics: {
        Args: { p_days_to_keep: number }
        Returns: undefined
      }
      requesting_tenant_id: { Args: never; Returns: string }
      resolve_item_availability: {
        Args: {
          p_branch_id: string
          p_menu_item_id: string
          p_resolved_at?: string
          p_tenant_id: string
        }
        Returns: {
          active_schedule_id: string
          branch_scope: boolean
          reason: string
          resolved_at: string
          source_type: string
          status: string
        }[]
      }
      resolve_item_availability_batch: {
        Args: {
          p_branch_id: string
          p_menu_item_ids: string[]
          p_resolved_at?: string
          p_tenant_id: string
        }
        Returns: {
          active_schedule_id: string
          branch_scope: boolean
          menu_item_id: string
          reason: string
          resolved_at: string
          source_type: string
          status: string
        }[]
      }
      resolve_menu_item_modifiers: {
        Args: { p_menu_item_id: string; p_tenant_id: string }
        Returns: {
          allow_quantity: boolean
          assignment_id: string
          description: string
          display_order: number
          group_name: string
          is_required: boolean
          max_qty_per_opt: number
          max_select: number
          min_qty_per_opt: number
          min_select: number
          modifier_group_id: string
          options: Json
          selection_mode: Database["public"]["Enums"]["modifier_selection_mode"]
        }[]
      }
      resolve_menu_item_price: {
        Args: {
          p_as_of?: string
          p_currency_code?: string
          p_menu_item_id: string
          p_tenant_id: string
        }
        Returns: {
          amount_minor: number
          currency_code: string
          effective_from: string
          effective_to: string
          menu_item_id: string
          price_id: string
          pricing_tier: string
          priority: number
          resolved_at: string
        }[]
      }
      resolve_menu_item_prices_batch: {
        Args: {
          p_as_of?: string
          p_currency_code?: string
          p_menu_item_ids: string[]
          p_tenant_id: string
        }
        Returns: {
          amount_minor: number
          currency_code: string
          menu_item_id: string
          price_id: string
          pricing_tier: string
          priority: number
        }[]
      }
      resolve_modifier_group_options: {
        Args: { p_modifier_group_id: string; p_tenant_id: string }
        Returns: {
          created_at: string
          description: string
          display_order: number
          id: string
          is_default: boolean
          modifier_group_id: string
          name: string
          parent_modifier_option_id: string
          price_delta_minor: number
          updated_at: string
          version_num: number
        }[]
      }
      resolve_tax_for_menu_item: {
        Args: {
          p_effective_at?: string
          p_menu_item_id: string
          p_tenant_id: string
        }
        Returns: {
          calculation_mode: Database["public"]["Enums"]["tax_calculation_mode"]
          tax_profile_id: string
          total_basis_points: number
        }[]
      }
      resolve_tax_for_menu_items_batch: {
        Args: {
          p_effective_at?: string
          p_menu_item_ids: string[]
          p_tenant_id: string
        }
        Returns: {
          calculation_mode: Database["public"]["Enums"]["tax_calculation_mode"]
          menu_item_id: string
          tax_profile_id: string
          total_basis_points: number
        }[]
      }
      revoke_role:
        | {
            Args: {
              p_revoked_by: string
              p_role: Database["public"]["Enums"]["admin_role"]
              p_tenant_id: string
              p_user_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_revoked_by: string
              p_role: Database["public"]["Enums"]["rbac_role"]
              p_tenant_id: string
              p_user_id: string
            }
            Returns: undefined
          }
      skip_order_review: {
        Args: { p_order_id: string; p_session_id: string; p_tenant_id: string }
        Returns: Json
      }
      submit_order_review: {
        Args: {
          p_comment: string
          p_food_rating: number
          p_order_id: string
          p_service_rating: number
          p_session_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      time_windows_overlap: {
        Args: { end1: string; end2: string; start1: string; start2: string }
        Returns: boolean
      }
      toggle_tenant_status: {
        Args: { p_action: string; p_tenant_id: string }
        Returns: Json
      }
      update_login_success: {
        Args: { p_ip_address: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      admin_role: "SUPER_ADMIN" | "RESTAURANT_ADMIN" | "MANAGER" | "STAFF"
      auth_event_type:
        | "LOGIN_SUCCESS"
        | "LOGIN_FAILED"
        | "LOGOUT"
        | "TOKEN_REFRESH"
        | "PASSWORD_RESET_REQUESTED"
        | "PASSWORD_RESET_COMPLETED"
        | "SESSION_EXPIRED"
        | "SESSION_REVOKED"
        | "ACCOUNT_LOCKED"
        | "SUSPICIOUS_ACTIVITY"
      availability_day:
        | "monday"
        | "tuesday"
        | "wednesday"
        | "thursday"
        | "friday"
        | "saturday"
        | "sunday"
      bill_status:
        | "UNPAID"
        | "PARTIALLY_PAID"
        | "PAID"
        | "FAILED"
        | "VOIDED"
        | "REFUNDED"
      cart_status: "open" | "locked" | "submitted" | "abandoned"
      device_status: "online" | "offline" | "suspended"
      device_type: "kds" | "pos" | "staff" | "admin"
      intent_status:
        | "created"
        | "authorized"
        | "captured"
        | "failed"
        | "expired"
      invoice_status:
        | "draft"
        | "issued"
        | "paid"
        | "partially_paid"
        | "voided"
        | "refunded"
      kitchen_item_status:
        | "pending"
        | "preparing"
        | "ready"
        | "completed"
        | "cancelled"
      kitchen_order_status:
        | "pending"
        | "accepted"
        | "preparing"
        | "ready"
        | "delivered"
        | "cancelled"
      menu_item_status: "active" | "inactive" | "archived"
      modifier_selection_mode: "single" | "multiple"
      order_source: "qr_scan" | "staff_pos" | "admin"
      order_status:
        | "pending"
        | "accepted"
        | "preparing"
        | "ready"
        | "delivered"
        | "completed"
        | "cancelled"
        | "sync_conflict"
      payment_method: "cash" | "card" | "qr_pay" | "wallet" | "split" | "other"
      payment_status: "pending" | "completed" | "failed" | "refunded"
      plan_status: "trial" | "active" | "expired" | "cancelled"
      plan_type: "DEMO" | "MONTHLY" | "YEARLY"
      pricing_type: "fixed" | "variable" | "complimentary"
      qr_session_status:
        | "active"
        | "expired"
        | "completed"
        | "invalidated"
        | "closed"
        | "abandoned"
      rbac_role: "super_admin" | "restaurant_admin" | "manager" | "staff"
      reservation_status:
        | "pending"
        | "confirmed"
        | "seated"
        | "cancelled"
        | "no_show"
      service_type: "dine_in" | "takeaway" | "delivery"
      spice_level: "none" | "mild" | "medium" | "hot" | "extra_hot"
      table_status:
        | "available"
        | "reserved"
        | "occupied"
        | "ordering"
        | "payment_pending"
        | "dirty"
      tax_calculation_mode: "inclusive" | "exclusive"
      user_role: "superadmin" | "org_admin" | "manager" | "staff" | "kds"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      admin_role: ["SUPER_ADMIN", "RESTAURANT_ADMIN", "MANAGER", "STAFF"],
      auth_event_type: [
        "LOGIN_SUCCESS",
        "LOGIN_FAILED",
        "LOGOUT",
        "TOKEN_REFRESH",
        "PASSWORD_RESET_REQUESTED",
        "PASSWORD_RESET_COMPLETED",
        "SESSION_EXPIRED",
        "SESSION_REVOKED",
        "ACCOUNT_LOCKED",
        "SUSPICIOUS_ACTIVITY",
      ],
      availability_day: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ],
      bill_status: [
        "UNPAID",
        "PARTIALLY_PAID",
        "PAID",
        "FAILED",
        "VOIDED",
        "REFUNDED",
      ],
      cart_status: ["open", "locked", "submitted", "abandoned"],
      device_status: ["online", "offline", "suspended"],
      device_type: ["kds", "pos", "staff", "admin"],
      intent_status: ["created", "authorized", "captured", "failed", "expired"],
      invoice_status: [
        "draft",
        "issued",
        "paid",
        "partially_paid",
        "voided",
        "refunded",
      ],
      kitchen_item_status: [
        "pending",
        "preparing",
        "ready",
        "completed",
        "cancelled",
      ],
      kitchen_order_status: [
        "pending",
        "accepted",
        "preparing",
        "ready",
        "delivered",
        "cancelled",
      ],
      menu_item_status: ["active", "inactive", "archived"],
      modifier_selection_mode: ["single", "multiple"],
      order_source: ["qr_scan", "staff_pos", "admin"],
      order_status: [
        "pending",
        "accepted",
        "preparing",
        "ready",
        "delivered",
        "completed",
        "cancelled",
        "sync_conflict",
      ],
      payment_method: ["cash", "card", "qr_pay", "wallet", "split", "other"],
      payment_status: ["pending", "completed", "failed", "refunded"],
      plan_status: ["trial", "active", "expired", "cancelled"],
      plan_type: ["DEMO", "MONTHLY", "YEARLY"],
      pricing_type: ["fixed", "variable", "complimentary"],
      qr_session_status: [
        "active",
        "expired",
        "completed",
        "invalidated",
        "closed",
        "abandoned",
      ],
      rbac_role: ["super_admin", "restaurant_admin", "manager", "staff"],
      reservation_status: [
        "pending",
        "confirmed",
        "seated",
        "cancelled",
        "no_show",
      ],
      service_type: ["dine_in", "takeaway", "delivery"],
      spice_level: ["none", "mild", "medium", "hot", "extra_hot"],
      table_status: [
        "available",
        "reserved",
        "occupied",
        "ordering",
        "payment_pending",
        "dirty",
      ],
      tax_calculation_mode: ["inclusive", "exclusive"],
      user_role: ["superadmin", "org_admin", "manager", "staff", "kds"],
    },
  },
} as const
