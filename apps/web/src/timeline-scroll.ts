let remembered = 0

/** Keeps the scroll position of the timeline while an entry page is open. */
export const rememberScroll = () => {
  remembered = window.scrollY
}

/** The remembered position, once. */
export const takeScroll = () => {
  const position = remembered
  remembered = 0
  return position
}
