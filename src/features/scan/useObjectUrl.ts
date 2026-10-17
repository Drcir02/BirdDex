import { useEffect, useState } from 'react'

/** An address for showing or playing a Blob (a photo or a clip), released again when the Blob changes or the screen goes away. */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!blob) {
      setUrl(undefined)
      return undefined
    }
    const created = URL.createObjectURL(blob)
    setUrl(created)
    return () => URL.revokeObjectURL(created)
  }, [blob])
  return blob ? url : undefined
}
