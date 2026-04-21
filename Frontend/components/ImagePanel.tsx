'use client'

type Props = {
  imageUrl: string | null
  title: string
}

export default function ImagePanel({ imageUrl, title }: Props) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        gap: 8,
        minWidth: 0,
      }}
    >
      {title ? <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2> : null}
      {imageUrl ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            padding: 4,
            border: '1px solid #ddd',
            borderRadius: 10,
            background: '#f7f7f7',
            boxSizing: 'border-box',
          }}
        >
          <img
            src={imageUrl}
            alt={title}
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              borderRadius: 8,
            }}
          />
        </div>
      ) : (
        <div style={{ padding: 24, border: '1px dashed #bbb', borderRadius: 8 }}>
          No image selected yet.
        </div>
      )}
    </div>
  )
}
