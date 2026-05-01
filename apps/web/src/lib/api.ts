const defaultBaseUrl = "http://127.0.0.1:8000";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export const apiBaseUrl = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL ?? defaultBaseUrl,
);

export function toApiAssetUrl(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${apiBaseUrl}${path}`;
}

export async function apiGet<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    method: "GET",
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let detail = `API request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // Ignore JSON parsing errors and fall back to the status message.
    }

    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = `API request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // Ignore JSON parsing errors and fall back to the status message.
    }

    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = `API request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // Ignore JSON parsing errors and fall back to the status message.
    }

    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export type TimelineZoom = "overview" | "mid" | "detail";

export type TimelineBucket = {
  bucket_start: string;
  bucket_end: string;
  photo_count: number;
  color_level: number;
  has_gap_label: boolean;
  gap_label: string | null;
};

export type TimelineBucketsResponse = {
  start: string;
  end: string;
  zoom: TimelineZoom;
  bucket_size: string;
  buckets: TimelineBucket[];
};

export type PhotoListItem = {
  id: string;
  file_path: string;
  file_name: string;
  thumbnail_path: string | null;
  timestamp_normalized: string;
  latitude: number | null;
  longitude: number | null;
};

export type PhotoListResponse = {
  total: number;
  items: PhotoListItem[];
};

export type PhotoRangeResponse = {
  start: string | null;
  end: string | null;
  photo_count: number;
};

export type PhotoDetail = PhotoListItem & {
  source_type: string;
  timestamp_original: string | null;
  timezone_offset: string | null;
  width: number | null;
  height: number | null;
  fingerprint: string | null;
  created_at: string;
  updated_at: string;
};

export type EnsureThumbnailsResponse = {
  items: Array<{
    id: string;
    thumbnail_path: string | null;
  }>;
};

export type MapPoint = {
  type: "photo";
  id: string;
  lat: number;
  lon: number;
  thumbnail_path: string | null;
  timestamp_normalized: string;
  file_name: string;
};

export type MapPointsResponse = {
  items: MapPoint[];
};

export type Visit = {
  id: string;
  title: string | null;
  start_time: string;
  end_time: string;
  center_lat: number | null;
  center_lon: number | null;
  photo_count: number;
  location_label: string | null;
};

export type VisitsResponse = {
  total: number;
  items: Visit[];
};

export async function getTimelineBuckets(params: {
  start: string;
  end: string;
  zoom: TimelineZoom;
  includeEmpty?: boolean;
}): Promise<TimelineBucketsResponse> {
  const query = new URLSearchParams({
    start: params.start,
    end: params.end,
    zoom: params.zoom,
    include_empty: String(params.includeEmpty ?? true),
  });

  return apiGet<TimelineBucketsResponse>(`/timeline/buckets?${query.toString()}`);
}

export async function getPhotosInBucket(params: {
  bucketStart: string;
  bucketEnd: string;
  limit?: number;
  offset?: number;
}): Promise<PhotoListResponse> {
  const query = new URLSearchParams({
    bucket_start: params.bucketStart,
    bucket_end: params.bucketEnd,
    limit: String(params.limit ?? 100),
    offset: String(params.offset ?? 0),
  });

  return apiGet<PhotoListResponse>(`/photos?${query.toString()}`);
}

export async function getPhoto(photoId: string): Promise<PhotoDetail> {
  return apiGet<PhotoDetail>(`/photos/${photoId}`);
}

export async function getPhotoRange(): Promise<PhotoRangeResponse> {
  return apiGet<PhotoRangeResponse>("/photos/range");
}

export async function ensureThumbnails(photoIds: string[]): Promise<EnsureThumbnailsResponse> {
  return apiPost<EnsureThumbnailsResponse>("/thumbnails/ensure", {
    photo_ids: photoIds,
  });
}

export function getPhotoFileUrl(photoId: string): string {
  return `${apiBaseUrl}/photos/${photoId}/file`;
}

export async function getMapPoints(params?: {
  start?: string;
  end?: string;
  cluster?: boolean;
}): Promise<MapPointsResponse> {
  const query = new URLSearchParams();

  if (params?.start) {
    query.set("start", params.start);
  }

  if (params?.end) {
    query.set("end", params.end);
  }

  if (params?.cluster !== undefined) {
    query.set("cluster", String(params.cluster));
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiGet<MapPointsResponse>(`/map/points${suffix}`);
}

export async function getVisits(params?: {
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
}): Promise<VisitsResponse> {
  const query = new URLSearchParams({
    limit: String(params?.limit ?? 100),
    offset: String(params?.offset ?? 0),
  });

  if (params?.start) {
    query.set("start", params.start);
  }

  if (params?.end) {
    query.set("end", params.end);
  }

  return apiGet<VisitsResponse>(`/visits?${query.toString()}`);
}

export async function getVisitPhotos(params: {
  visitId: string;
  limit?: number;
  offset?: number;
}): Promise<PhotoListResponse> {
  const query = new URLSearchParams({
    limit: String(params.limit ?? 100),
    offset: String(params.offset ?? 0),
  });

  return apiGet<PhotoListResponse>(`/visits/${params.visitId}/photos?${query.toString()}`);
}

export async function updateVisitTitle(params: {
  visitId: string;
  title: string;
}): Promise<Visit> {
  return apiPatch<Visit>(`/visits/${params.visitId}`, {
    title: params.title,
  });
}
