import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';

export type DeviceType = ApiSchema<'DeviceTypeEnum'>;

export type DeviceToken = ApiResponse<'api_device_tokens_retrieve'>;

export type RegisterDeviceTokenRequest = ApiRequest<'api_device_tokens_register_create'>;

export type UnregisterDeviceTokenRequest = ApiRequest<'api_device_tokens_unregister_create'>;

export type NotificationPreferences = ApiResponse<'api_notification_preferences_list'>;

export type UpdateNotificationPreferencesRequest = ApiRequest<'api_notification_preferences_create'>;

export type NotificationType = ApiSchema<'NotificationTypeEnum'>;

export type Notification = ApiResponse<'api_notifications_retrieve'>;

export type UnreadCountResponse = ApiResponse<'api_notifications_unread_count_retrieve'>;

export type MarkAllReadResponse = ApiResponse<'api_notifications_mark_all_read_create'>;
