import { h, ref, computed, watch, onBeforeUnmount, onActivated, onDeactivated, getCurrentInstance, provide } from 'vue'

import QIcon from '../icon/QIcon.js'
import QResizeObserver from '../resize-observer/QResizeObserver.js'

import useTick from '../../composables/private/use-tick.js'
import useTimeout from '../../composables/private/use-timeout.js'

import { createComponent } from '../../utils/private/create.js'
import { noop } from '../../utils/event.js'
import { hSlot } from '../../utils/private/render.js'
import { tabsKey } from '../../utils/private/symbols.js'
import { rtlHasScrollBug } from '../../utils/private/rtl.js'
import { isDeepEqual } from '../../utils/is.js'

function getIndicatorClass (color, top, vertical) {
  const pos = vertical === true
    ? [ 'left', 'right' ]
    : [ 'top', 'bottom' ]

  return `absolute-${ top === true ? pos[ 0 ] : pos[ 1 ] }${ color ? ` text-${ color }` : '' }`
}

const alignValues = [ 'left', 'center', 'right', 'justify' ]

export default createComponent({
  name: 'QTabs',

  props: {
    modelValue: [ Number, String ],

    align: {
      type: String,
      default: 'center',
      validator: v => alignValues.includes(v)
    },
    breakpoint: {
      type: [ String, Number ],
      default: 600
    },

    vertical: Boolean,
    shrink: Boolean,
    stretch: Boolean,

    activeClass: String,
    activeColor: String,
    activeBgColor: String,
    indicatorColor: String,
    leftIcon: String,
    rightIcon: String,

    outsideArrows: Boolean,
    mobileArrows: Boolean,

    switchIndicator: Boolean,

    narrowIndicator: Boolean,
    inlineLabel: Boolean,
    noCaps: Boolean,

    dense: Boolean,

    contentClass: String,

    'onUpdate:modelValue': [ Function, Array ]
  },

  setup (props, { slots, emit }) {
    const { proxy } = getCurrentInstance()
    const { $q } = proxy

    const { registerTick: registerScrollTick } = useTick()
    const { registerTick: registerUpdateArrowsTick } = useTick()
    const { registerTick: registerAnimateTick } = useTick()

    const { registerTimeout: registerFocusTimeout, removeTimeout: removeFocusTimeout } = useTimeout()
    const { registerTimeout: registerScrollToTabTimeout, removeTimeout: removeScrollToTabTimeout } = useTimeout()

    const rootRef = ref(null)
    const contentRef = ref(null)

    const currentModel = ref(props.modelValue)
    const scrollable = ref(false)
    const leftArrow = ref(true)
    const rightArrow = ref(false)
    const justify = ref(false)

    const arrowsEnabled = computed(() =>
      $q.platform.is.desktop === true || props.mobileArrows === true
    )

    const tabDataList = []
    const tabDataListLen = ref(0)
    const hasFocus = ref(false)

    let animateTimer, scrollTimer, unwatchRoute
    let localUpdateArrows = arrowsEnabled.value === true
      ? updateArrowsFn
      : noop

    const tabProps = computed(() => ({
      activeClass: props.activeClass,
      activeColor: props.activeColor,
      activeBgColor: props.activeBgColor,
      indicatorClass: getIndicatorClass(
        props.indicatorColor,
        props.switchIndicator,
        props.vertical
      ),
      narrowIndicator: props.narrowIndicator,
      inlineLabel: props.inlineLabel,
      noCaps: props.noCaps
    }))

    const hasActiveTab = computed(() => {
      const len = tabDataListLen.value
      const val = currentModel.value

      for (let i = 0; i < len; i++) {
        if (tabDataList[ i ].name.value === val) {
          return true
        }
      }

      return false
    })

    const alignClass = computed(() => {
      const align = scrollable.value === true
        ? 'left'
        : (justify.value === true ? 'justify' : props.align)

      return `q-tabs__content--align-${ align }`
    })

    const classes = computed(() =>
      'q-tabs row no-wrap items-center'
      + ` q-tabs--${ scrollable.value === true ? '' : 'not-' }scrollable`
      + ` q-tabs--${ props.vertical === true ? 'vertical' : 'horizontal' }`
      + ` q-tabs__arrows--${ arrowsEnabled.value === true && props.outsideArrows === true ? 'outside' : 'inside' }`
      + (props.dense === true ? ' q-tabs--dense' : '')
      + (props.shrink === true ? ' col-shrink' : '')
      + (props.stretch === true ? ' self-stretch' : '')
    )

    const innerClass = computed(() =>
      'q-tabs__content row no-wrap items-center self-stretch hide-scrollbar relative-position '
      + alignClass.value
      + (props.contentClass !== void 0 ? ` ${ props.contentClass }` : '')
      + ($q.platform.is.mobile === true ? ' scroll' : '')
    )

    const domProps = computed(() => (
      props.vertical === true
        ? { container: 'height', content: 'offsetHeight', scroll: 'scrollHeight' }
        : { container: 'width', content: 'offsetWidth', scroll: 'scrollWidth' }
    ))

    const isRTL = computed(() => props.vertical !== true && $q.lang.rtl === true)
    const rtlPosCorrection = computed(() => rtlHasScrollBug === false && isRTL.value === true)

    watch(isRTL, localUpdateArrows)

    watch(() => props.modelValue, name => {
      updateModel({ name, setCurrent: true, skipEmit: true })
    })

    watch(() => props.outsideArrows, () => {
      recalculateScroll()
    })

    watch(arrowsEnabled, v => {
      localUpdateArrows = v === true
        ? updateArrowsFn
        : noop

      recalculateScroll()
    })

    function updateModel ({ name, setCurrent, skipEmit, fromRoute }) {
      if (currentModel.value !== name) {
        if (skipEmit !== true && props[ 'onUpdate:modelValue' ] !== void 0) {
          emit('update:modelValue', name)
        }

        if (
          setCurrent === true
          || props[ 'onUpdate:modelValue' ] === void 0
        ) {
          animate(currentModel.value, name)
          currentModel.value = name
        }
      }
    }

    function recalculateScroll () {
      registerScrollTick(() => {
        updateContainer({
          width: rootRef.value.offsetWidth,
          height: rootRef.value.offsetHeight
        })
      })
    }

    function updateContainer (domSize) {
      // it can be called faster than component being initialized
      // so we need to protect against that case
      // (one example of such case is the docs release notes page)
      if (domProps.value === void 0 || contentRef.value === null) { return }

      const
        size = domSize[ domProps.value.container ],
        scrollSize = Math.min(
          contentRef.value[ domProps.value.scroll ],
          Array.prototype.reduce.call(
            contentRef.value.children,
            (acc, el) => acc + (el[ domProps.value.content ] || 0),
            0
          )
        ),
        scroll = size > 0 && scrollSize > size // when there is no tab, in Chrome, size === 0 and scrollSize === 1

      scrollable.value = scroll

      // Arrows need to be updated even if the scroll status was already true
      scroll === true && registerUpdateArrowsTick(localUpdateArrows)

      justify.value = size < parseInt(props.breakpoint, 10)
    }

    function animate (oldName, newName) {
      const
        oldTab = oldName !== void 0 && oldName !== null && oldName !== ''
          ? tabDataList.find(tab => tab.name.value === oldName)
          : null,
        newTab = newName !== void 0 && newName !== null && newName !== ''
          ? tabDataList.find(tab => tab.name.value === newName)
          : null

      if (oldTab && newTab) {
        const
          oldEl = oldTab.tabIndicatorRef.value,
          newEl = newTab.tabIndicatorRef.value

        clearTimeout(animateTimer)

        oldEl.style.transition = 'none'
        oldEl.style.transform = 'none'
        newEl.style.transition = 'none'
        newEl.style.transform = 'none'

        const
          oldPos = oldEl.getBoundingClientRect(),
          newPos = newEl.getBoundingClientRect()

        newEl.style.transform = props.vertical === true
          ? `translate3d(0,${ oldPos.top - newPos.top }px,0) scale3d(1,${ newPos.height ? oldPos.height / newPos.height : 1 },1)`
          : `translate3d(${ oldPos.left - newPos.left }px,0,0) scale3d(${ newPos.width ? oldPos.width / newPos.width : 1 },1,1)`

        // allow scope updates to kick in (QRouteTab needs more time)
        registerAnimateTick(() => {
          animateTimer = setTimeout(() => {
            newEl.style.transition = 'transform .25s cubic-bezier(.4, 0, .2, 1)'
            newEl.style.transform = 'none'
          }, 70)
        })
      }

      if (newTab && scrollable.value === true) {
        scrollToTabEl(newTab.rootRef.value)
      }
    }

    function scrollToTabEl (el) {
      const
        { left, width, top, height } = contentRef.value.getBoundingClientRect(),
        newPos = el.getBoundingClientRect()

      let offset = props.vertical === true ? newPos.top - top : newPos.left - left

      if (offset < 0) {
        contentRef.value[ props.vertical === true ? 'scrollTop' : 'scrollLeft' ] += Math.floor(offset)
        localUpdateArrows()
        return
      }

      offset += props.vertical === true ? newPos.height - height : newPos.width - width
      if (offset > 0) {
        contentRef.value[ props.vertical === true ? 'scrollTop' : 'scrollLeft' ] += Math.ceil(offset)
        localUpdateArrows()
      }
    }

    function updateArrowsFn () {
      const content = contentRef.value
      if (content !== null) {
        const
          rect = content.getBoundingClientRect(),
          pos = props.vertical === true ? content.scrollTop : Math.abs(content.scrollLeft)

        if (isRTL.value === true) {
          leftArrow.value = Math.ceil(pos + rect.width) < content.scrollWidth - 1
          rightArrow.value = pos > 0
        }
        else {
          leftArrow.value = pos > 0
          rightArrow.value = props.vertical === true
            ? Math.ceil(pos + rect.height) < content.scrollHeight
            : Math.ceil(pos + rect.width) < content.scrollWidth
        }
      }
    }

    function animScrollTo (value) {
      stopAnimScroll()
      scrollTimer = setInterval(() => {
        if (scrollTowards(value) === true) {
          stopAnimScroll()
        }
      }, 5)
    }

    function scrollToStart () {
      animScrollTo(rtlPosCorrection.value === true ? Number.MAX_SAFE_INTEGER : 0)
    }

    function scrollToEnd () {
      animScrollTo(rtlPosCorrection.value === true ? 0 : Number.MAX_SAFE_INTEGER)
    }

    function stopAnimScroll () {
      clearInterval(scrollTimer)
    }

    function onKbdNavigate (keyCode, fromEl) {
      const tabs = Array.prototype.filter.call(
        contentRef.value.children,
        el => el === fromEl || (el.matches && el.matches('.q-tab.q-focusable') === true)
      )

      const len = tabs.length
      if (len === 0) { return }

      if (keyCode === 36) { // Home
        scrollToTabEl(tabs[ 0 ])
        tabs[ 0 ].focus()
        return true
      }
      if (keyCode === 35) { // End
        scrollToTabEl(tabs[ len - 1 ])
        tabs[ len - 1 ].focus()
        return true
      }

      const dirPrev = keyCode === (props.vertical === true ? 38 /* ArrowUp */ : 37 /* ArrowLeft */)
      const dirNext = keyCode === (props.vertical === true ? 40 /* ArrowDown */ : 39 /* ArrowRight */)

      const dir = dirPrev === true ? -1 : (dirNext === true ? 1 : void 0)

      if (dir !== void 0) {
        const rtlDir = isRTL.value === true ? -1 : 1
        const index = tabs.indexOf(fromEl) + dir * rtlDir

        if (index >= 0 && index < len) {
          scrollToTabEl(tabs[ index ])
          tabs[ index ].focus({ preventScroll: true })
        }

        return true
      }
    }

    // let's speed up execution of time-sensitive scrollTowards()
    // with a computed variable by directly applying the minimal
    // number of instructions on get/set functions
    const posFn = computed(() => (
      rtlPosCorrection.value === true
        ? { get: content => Math.abs(content.scrollLeft), set: (content, pos) => { content.scrollLeft = -pos } }
        : (
            props.vertical === true
              ? { get: content => content.scrollTop, set: (content, pos) => { content.scrollTop = pos } }
              : { get: content => content.scrollLeft, set: (content, pos) => { content.scrollLeft = pos } }
          )
    ))

    function scrollTowards (value) {
      const
        content = contentRef.value,
        { get, set } = posFn.value

      let
        done = false,
        pos = get(content)

      const direction = value < pos ? -1 : 1

      pos += direction * 5

      if (pos < 0) {
        done = true
        pos = 0
      }
      else if (
        (direction === -1 && pos <= value)
        || (direction === 1 && pos >= value)
      ) {
        done = true
        pos = value
      }

      set(content, pos)
      localUpdateArrows()

      return done
    }

    function hasActiveNonRouteTab () {
      return tabDataList.some(tab => tab.routeData === void 0 && tab.name.value === currentModel.value)
    }

    function hasQueryIncluded (targetQuery, matchingQuery) {
      for (const key in targetQuery) {
        if (isDeepEqual(targetQuery[ key ], matchingQuery[ key ]) === false) {
          return false
        }
      }

      return true
    }

    // do not use directly; use verifyRouteModel() instead
    function updateActiveRoute () {
      let name = null
      const bestScore = { matchedLen: 0, queryDiff: 9999, hrefLen: 0 }

      const list = tabDataList.filter(tab => tab.routeData !== void 0 && tab.routeData.hasRouterLink.value === true)
      const { hash: currentHash, query: currentQuery } = proxy.$route

      // Vue Router does not keep account of hash & query when matching
      // so we're doing this as well

      for (const tab of list) {
        const exact = tab.routeData.exact.value === true

        if (tab.routeData[ exact === true ? 'linkIsExactActive' : 'linkIsActive' ].value !== true) {
          // it cannot match anything as it's not active nor exact-active
          continue
        }

        const { hash, query, matched, href } = tab.routeData.resolvedLink.value

        if (exact === true) {
          if (hash !== currentHash) {
            // it's set to exact but it doesn't matches the hash
            continue
          }

          if (
            Object.keys(query).length !== Object.keys(currentQuery).length
            || hasQueryIncluded(currentQuery, query) === false
          ) {
            // it's set to exact but it doesn't matches the query
            continue
          }

          // yey, we found the perfect match (route + hash + query)
          name = tab.name.value
          break
        }

        if (hash !== '' && hash !== currentHash) {
          // it has hash and it doesn't matches
          continue
        }

        if (Object.keys(query).length !== 0 && hasQueryIncluded(query, currentQuery) === false) {
          // it has query and it doesn't includes the current one
          continue
        }

        const matchedLen = matched.length
        const queryDiff = Object.keys(currentQuery).length - Object.keys(query).length
        const hrefLen = href.length - hash.length

        if (matchedLen > bestScore.matchedLen) {
          // it matches more routes so it's more specific so we set it as current champion
          name = tab.name.value
          Object.assign(bestScore, { queryDiff, matchedLen, hrefLen })
          continue
        }
        else if (matchedLen !== bestScore.matchedLen) {
          // it matches less routes than the current champion so we discard it
          continue
        }

        if (queryDiff < bestScore.queryDiff) {
          // query is closer to the current one so we set it as current champion
          name = tab.name.value
          Object.assign(bestScore, { queryDiff, matchedLen, hrefLen })
          continue
        }
        else if (queryDiff !== bestScore.queryDiff) {
          // query is farther away than current champion so we discard it
          continue
        }

        if (hrefLen > bestScore.hrefLen) {
          // href is lengthier so it's more specific so we set it as current champion
          name = tab.name.value
          Object.assign(bestScore, { queryDiff, matchedLen, hrefLen })
          continue
        }
      }

      if (name === null && hasActiveNonRouteTab() === true) {
        // we shouldn't interfere if non-route tab is active
        return
      }

      updateModel({ name, setCurrent: true })
    }

    function onFocusin (e) {
      removeFocusTimeout()

      if (
        hasFocus.value !== true
        && rootRef.value !== null
        && e.target
        && typeof e.target.closest === 'function'
      ) {
        const tab = e.target.closest('.q-tab')

        // if the target is contained by a QTab/QRouteTab
        // (it might be other elements focused, like additional QBtn)
        if (tab && rootRef.value.contains(tab) === true) {
          hasFocus.value = true
          scrollable.value === true && scrollToTabEl(tab)
        }
      }
    }

    function onFocusout () {
      registerFocusTimeout(() => { hasFocus.value = false }, 30)
    }

    function verifyRouteModel () {
      if ($tabs.avoidRouteWatcher === false) {
        registerScrollToTabTimeout(updateActiveRoute)
      }
      else {
        removeScrollToTabTimeout()
      }
    }

    function watchRoute () {
      if (unwatchRoute === void 0) {
        const unwatch = watch(() => proxy.$route.fullPath, verifyRouteModel)
        unwatchRoute = () => {
          unwatch()
          unwatchRoute = void 0
        }
      }
    }

    function registerTab (tabData) {
      tabDataList.push(tabData)
      tabDataListLen.value++

      recalculateScroll()

      // if it's a QTab
      if (tabData.routeData === void 0) {
        // we should position to the currently active tab (if any)
        registerScrollToTabTimeout(() => {
          if (scrollable.value === true) {
            const value = currentModel.value
            const newTab = value !== void 0 && value !== null && value !== ''
              ? tabDataList.find(tab => tab.name.value === value)
              : null

            newTab && scrollToTabEl(newTab.rootRef.value)
          }
        })
      }
      // else if it's a QRouteTab with a valid link
      else {
        // start watching route
        watchRoute()

        if (tabData.routeData.hasRouterLink.value === true) {
          verifyRouteModel()
        }
      }
    }

    /*
     * Vue has an aggressive diff (in-place replacement) so we cannot
     * ensure that the instance getting destroyed is the actual tab
     * reported here. As a result, we cannot use its name or check
     * if it's a route one to make the necessary updates. We need to
     * always check the existing list again and infer the changes.
     */
    function unregisterTab (tabData) {
      tabDataList.splice(tabDataList.indexOf(tabData), 1)
      tabDataListLen.value--

      recalculateScroll()

      if (unwatchRoute !== void 0 && tabData.routeData !== void 0) {
        // unwatch route if we don't have any QRouteTabs left
        if (tabDataList.every(tab => tab.routeData === void 0) === true) {
          unwatchRoute()
        }

        // then update model
        verifyRouteModel()
      }
    }

    const $tabs = {
      currentModel,
      tabProps,
      hasFocus,
      hasActiveTab,

      registerTab,
      unregisterTab,

      verifyRouteModel,
      updateModel,
      onKbdNavigate,

      avoidRouteWatcher: false // false | string (uid)
    }

    provide(tabsKey, $tabs)

    function cleanup () {
      clearTimeout(animateTimer)
      stopAnimScroll()
      unwatchRoute !== void 0 && unwatchRoute()
    }

    let hadRouteWatcher

    onBeforeUnmount(cleanup)

    onDeactivated(() => {
      hadRouteWatcher = unwatchRoute !== void 0
      cleanup()
    })

    onActivated(() => {
      hadRouteWatcher === true && watchRoute()
      recalculateScroll()
    })

    return () => {
      const child = [
        h(QResizeObserver, { onResize: updateContainer }),

        h('div', {
          ref: contentRef,
          class: innerClass.value,
          onScroll: localUpdateArrows
        }, hSlot(slots.default))
      ]

      arrowsEnabled.value === true && child.push(
        h(QIcon, {
          class: 'q-tabs__arrow q-tabs__arrow--left absolute q-tab__icon'
            + (leftArrow.value === true ? '' : ' q-tabs__arrow--faded'),
          name: props.leftIcon || $q.iconSet.tabs[ props.vertical === true ? 'up' : 'left' ],
          onMousedownPassive: scrollToStart,
          onTouchstartPassive: scrollToStart,
          onMouseupPassive: stopAnimScroll,
          onMouseleavePassive: stopAnimScroll,
          onTouchendPassive: stopAnimScroll
        }),

        h(QIcon, {
          class: 'q-tabs__arrow q-tabs__arrow--right absolute q-tab__icon'
            + (rightArrow.value === true ? '' : ' q-tabs__arrow--faded'),
          name: props.rightIcon || $q.iconSet.tabs[ props.vertical === true ? 'down' : 'right' ],
          onMousedownPassive: scrollToEnd,
          onTouchstartPassive: scrollToEnd,
          onMouseupPassive: stopAnimScroll,
          onMouseleavePassive: stopAnimScroll,
          onTouchendPassive: stopAnimScroll
        })
      )

      return h('div', {
        ref: rootRef,
        class: classes.value,
        role: 'tablist',
        onFocusin,
        onFocusout
      }, child)
    }
  }
})
