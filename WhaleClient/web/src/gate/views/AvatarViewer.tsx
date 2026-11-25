/** 头像放大查看 */
export const AvatarViewer = ({ src, onClose }: { src: string; onClose: () => void }) => (
  <div className='avatar-mask' onClick={onClose} role='presentation'>
    <img className='avatar-big' src={src} alt='' onClick={(event) => event.stopPropagation()} />
  </div>
)
