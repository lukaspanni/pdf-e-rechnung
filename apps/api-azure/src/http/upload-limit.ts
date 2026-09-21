/** Maximum multipart request size accepted by both API transports. */
export const maxUploadBytes = 25 * 1024 * 1024

export const uploadTooLargeResponse = {
  error: {
    code: 'UPLOAD_TOO_LARGE',
    message: 'Upload exceeds the 25 MiB limit.',
  },
} as const
