import { useSelector, useDispatch } from 'react-redux';
import { useCallback, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';

import { useAuth } from './useAuth';
import { formatVariantLabel } from '../utils/variantUtils';

import {
  fetchCart,
  addToCart as addToCartAction,
  updateCartQuantity,
  removeFromCart as removeFromCartAction,
  clearCart as clearCartAction,
  syncLocalCart,
  mergeGuestCart,
  addToCartOptimistic,
  updateQuantityOptimistic,
  removeFromCartOptimistic,
  loadFromCache,
  loadFromLocalStorage,
  clearError,
  resetCartState,
  selectCartItems,
  selectCartTotal,
  selectCartCount,
  selectCartLoading,
  selectCartError,
  selectIsOptimisticLoading,
  selectDbCartLoaded,
  selectPendingOperations,
  selectItemQuantity,
  selectIsItemInCart,
  selectCartItemByProductId
} from '../redux/cartSlice';

const CART_CACHE_KEY = 'lapatisserie_cart_cache';
const CART_CACHE_TIMESTAMP_KEY = 'lapatisserie_cart_cache_timestamp';
const LOCAL_CART_KEY = 'lapatisserie_cart';
const CACHE_DURATION = 30000; // 30 seconds

const interpretEggHint = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['true', 'yes', 'y', '1'].includes(normalized)) {
    return true;
  }

  if (['false', 'no', 'n', '0'].includes(normalized)) {
    return false;
  }

  if (
    normalized.includes('eggless') ||
    normalized.includes('no egg') ||
    normalized.includes('egg free') ||
    normalized.includes('egg-free') ||
    normalized.includes('without egg') ||
    normalized.includes('pure veg') ||
    normalized.includes('veg only')
  ) {
    return false;
  }

  if (
    normalized.includes('with egg') ||
    normalized.includes('contains egg') ||
    normalized.includes('has egg') ||
    normalized.includes('egg-based') ||
    normalized.includes('egg ')
  ) {
    return true;
  }

  if (normalized.includes('egg')) {
    return true;
  }

  return null;
};

const inferEggFlag = (source) => {
  if (!source) {
    return null;
  }

  if (typeof source.hasEgg === 'boolean') {
    return source.hasEgg;
  }

  const candidates = [
    source?.hasEgg,
    source?.importantField?.value,
    source?.importantField?.name,
    source?.eggType,
    source?.eggLabel,
    source?.egg,
    source?.isEgg,
    source?.extraFields?.egg,
    source?.extraFields?.Egg,
    source?.extraFields?.eggType,
    source?.extraFields?.EggType
  ];

  for (const candidate of candidates) {
    const interpreted = interpretEggHint(candidate);
    if (typeof interpreted === 'boolean') {
      return interpreted;
    }
  }

  return null;
};

const resolveEggFlag = (product, variantIndex) => {
  if (!product) {
    return null;
  }

  const variantFromIndex = Number.isInteger(variantIndex) && Array.isArray(product?.variants)
    ? product.variants[variantIndex]
    : undefined;

  const selectedVariant = variantFromIndex || product?.selectedVariant;

  const variantEgg = inferEggFlag(selectedVariant);
  if (typeof variantEgg === 'boolean') {
    return variantEgg;
  }

  const directEgg = inferEggFlag(product);
  if (typeof directEgg === 'boolean') {
    return directEgg;
  }

  const nestedEgg = inferEggFlag(product?.productDetails);
  if (typeof nestedEgg === 'boolean') {
    return nestedEgg;
  }

  return null;
};

export const useCart = () => {
  const dispatch = useDispatch();
  const { user } = useAuth();

  // Selectors
  const cartItems = useSelector(selectCartItems);
  const cartTotal = useSelector(selectCartTotal);
  const backendCartCount = useSelector(selectCartCount);
  const isLoading = useSelector(selectCartLoading);
  
  // Calculate actual cart count from items (sum of all quantities)
  const cartCount = useMemo(() => {
    try {
      if (!Array.isArray(cartItems)) {
        console.warn('🛒 cartItems is not an array:', cartItems);
        return 0;
      }
      
      const actualCount = cartItems.reduce((total, item) => {
        if (!item) return total;
        return total + (item.quantity || 0);
      }, 0);
      
      console.log('🛒 Cart Count Calculation:', {
        actualCount,
        backendCount: backendCartCount,
        cartItems: cartItems.map(item => ({ 
          name: item?.name || 'Unknown', 
          quantity: item?.quantity || 0 
        }))
      });
      
      return actualCount;
    } catch (error) {
      console.error('🛒 Error calculating cart count:', error);
      return backendCartCount || 0;
    }
  }, [cartItems, backendCartCount]);
  const error = useSelector(selectCartError);
  const isOptimisticLoading = useSelector(selectIsOptimisticLoading);
  const dbCartLoaded = useSelector(selectDbCartLoaded);
  const pendingOperations = useSelector(selectPendingOperations);

  // Helper functions
  const getItemQuantity = useCallback((productId) => {
    const item = cartItems.find(item => item.productId === productId);
    return item ? item.quantity : 0;
  }, [cartItems]);

  const isItemInCart = useCallback((productId) => {
    return cartItems.some(item => item.productId === productId);
  }, [cartItems]);

  const getCartItem = useCallback((productId) => {
    return cartItems.find(item => item.productId === productId);
  }, [cartItems]);

  // Local storage utilities
  const getLocalCart = useCallback(() => {
    try {
      const localCart = localStorage.getItem(LOCAL_CART_KEY);
      return localCart ? JSON.parse(localCart) : [];
    } catch (error) {
      console.error('Error reading local cart:', error);
      return [];
    }
  }, []);

  const saveToLocalStorage = useCallback((items) => {
    try {
      if (!user) {
        localStorage.setItem(LOCAL_CART_KEY, JSON.stringify(items));
      }
    } catch (error) {
      console.error('Error saving to local storage:', error);
    }
  }, [user]);

  const getCachedCart = useCallback(() => {
    try {
      const cachedCart = localStorage.getItem(CART_CACHE_KEY);
      const cachedTimestamp = localStorage.getItem(CART_CACHE_TIMESTAMP_KEY);
      
      if (cachedCart && cachedTimestamp) {
        const isValid = (Date.now() - parseInt(cachedTimestamp, 10)) < CACHE_DURATION;
        if (isValid) {
          return JSON.parse(cachedCart);
        }
      }
      return null;
    } catch (error) {
      console.error('Error reading cached cart:', error);
      return null;
    }
  }, []);

  const saveToCache = useCallback((data) => {
    try {
      localStorage.setItem(CART_CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CART_CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (error) {
      console.error('Error saving to cache:', error);
    }
  }, []);

  // 🛠️ FIX: Handle cart state reset when user logs out
  useEffect(() => {
    if (!user) {
      // User logged out - reset cart state to prevent conflicts
      console.log('🔄 User logged out - resetting cart state');
      dispatch(resetCartState());
    }
  }, [user, dispatch]);

  // Load cart on mount and user change with improved synchronization
  useEffect(() => {
    const loadCart = async () => {
      if (user && !dbCartLoaded) {
        console.log('👤 User logged in - checking for cart data...');
        
        // Try cache first for faster loading
        const cachedCart = getCachedCart();
        if (cachedCart) {
          console.log('📦 Loading cart from cache');
          dispatch(loadFromCache(cachedCart));
          return;
        }

        // Check for guest cart to merge
        const localCart = getLocalCart();
        if (localCart.length > 0) {
          console.log(`🔄 Found guest cart with ${localCart.length} items - merging with user account`);
          try {
            // Use the new merge functionality
            await dispatch(mergeGuestCart(localCart)).unwrap();
            // Clear local storage after successful merge
            localStorage.removeItem(LOCAL_CART_KEY);
            console.log('✅ Guest cart merged and localStorage cleared');
          } catch (error) {
            console.error('❌ Failed to merge guest cart, falling back to sync:', error);
            // Fallback to old sync method
            dispatch(syncLocalCart(localCart));
            localStorage.removeItem(LOCAL_CART_KEY);
          }
        } else {
          // No guest cart, fetch from database
          console.log('🌐 Fetching cart from database');
          dispatch(fetchCart());
        }
      } else if (!user) {
        // Load from local storage for guest users only if cart state is empty
        const currentCartItems = cartItems || [];
        if (currentCartItems.length === 0) {
          const localCart = getLocalCart();
          if (localCart.length > 0) {
            console.log(`👤 Loading guest cart with ${localCart.length} items from localStorage`);
            dispatch(loadFromLocalStorage(localCart));
          }
        }
      }
    };

    loadCart();
  }, [user, dbCartLoaded, dispatch, getCachedCart, getLocalCart, cartItems]);

  // Save to localStorage for guest users
  useEffect(() => {
    if (!user && cartItems.length > 0) {
      saveToLocalStorage(cartItems);
    }
  }, [cartItems, user, saveToLocalStorage]);

  // Cache cart data for authenticated users
  useEffect(() => {
    if (user && cartItems.length > 0) {
      const cacheData = {
        items: cartItems,
        cartTotal,
        cartCount
      };
  saveToCache(cacheData);
    }
  }, [cartItems, cartTotal, cartCount, user, saveToCache]);

  // Cart operations with optimistic updates
  const addToCart = useCallback(async (product, quantity = 1, variantIndex) => {
    try {
      if (!product || !product._id) {
        throw new Error('Invalid product data');
      }

      const candidateVariantIndex = Number.isInteger(variantIndex)
        ? variantIndex
        : Number.isInteger(product?.productDetails?.variantIndex)
          ? product.productDetails.variantIndex
          : Number.isInteger(product?.selectedVariantIndex)
            ? product.selectedVariantIndex
            : null;

      const normalizedVariantIndex = Number.isInteger(candidateVariantIndex)
        ? candidateVariantIndex
        : 0;

      const eggFlag = resolveEggFlag(product, normalizedVariantIndex);
      const productForCart =
        typeof eggFlag === 'boolean' && product?.hasEgg !== eggFlag
          ? { ...product, hasEgg: eggFlag }
          : product;

      const variantsArray = Array.isArray(productForCart?.variants)
        ? productForCart.variants.map((entry) => (
            typeof entry === 'object' && entry !== null
              ? {
                  ...entry,
                  variantLabel: formatVariantLabel(entry)
                }
              : entry
          ))
        : [];

      const variantFromArray = variantsArray[normalizedVariantIndex] || variantsArray[0] || null;

      const selectedVariant = variantFromArray
        || (productForCart?.selectedVariant
          ? {
              ...productForCart.selectedVariant,
              variantLabel: formatVariantLabel(productForCart.selectedVariant)
            }
          : null);

      const variantLabel = formatVariantLabel(selectedVariant) || productForCart?.variantLabel || '';

      const enrichedProduct = {
        ...productForCart,
        variants: variantsArray,
        selectedVariantIndex: normalizedVariantIndex,
        selectedVariant,
        variantLabel
      };

      console.log(
        `🛒 Adding ${quantity}x ${enrichedProduct.name} to cart${Number.isInteger(normalizedVariantIndex) ? ` (variant ${normalizedVariantIndex})` : ''}`
      );

      if (user) {
        // For authenticated users: optimistic update + API call
        dispatch(addToCartOptimistic({ product: enrichedProduct, quantity, variantIndex: normalizedVariantIndex }));
        const result = await dispatch(addToCartAction({ product: enrichedProduct, quantity, variantIndex: normalizedVariantIndex })).unwrap();
        console.log('✅ Item added to cart successfully');
        return result;
      } else {
        // For guest users: local storage only
        const localCart = getLocalCart();
        const existingItemIndex = localCart.findIndex(item => item.productId === enrichedProduct._id);
        const safeVariantIndex = normalizedVariantIndex;
        const productDetails = {
          ...enrichedProduct,
          variantIndex: safeVariantIndex,
          hasEgg: typeof eggFlag === 'boolean' ? eggFlag : enrichedProduct?.hasEgg,
          variantLabel: enrichedProduct.variantLabel
        };
        
        if (existingItemIndex >= 0) {
          localCart[existingItemIndex].quantity += quantity;
          localCart[existingItemIndex].productDetails = {
            ...localCart[existingItemIndex].productDetails,
            ...productDetails
          };
        } else {
          localCart.push({
            id: `local_${Date.now()}`,
            productId: enrichedProduct._id,
            name: enrichedProduct.name,
            price: (Number.isInteger(safeVariantIndex) && enrichedProduct.variants?.[safeVariantIndex]?.price)
              ? enrichedProduct.variants[safeVariantIndex].price
              : enrichedProduct.price,
            image: enrichedProduct.images?.[0] || enrichedProduct.image,
            quantity,
            addedAt: new Date().toISOString(),
            productDetails
          });
        }
        
        saveToLocalStorage(localCart);
        dispatch(loadFromLocalStorage(localCart));
        console.log('✅ Item added to local cart');
      }
    } catch (error) {
      console.error('❌ Error adding to cart:', error);
      const message = typeof error?.error === 'string' ? error.error : error?.message || 'Failed to add item to cart';
      // Show immediate toast for user feedback
      toast.error(message === 'Insufficient stock available' ? 'Insufficient stock available' : message);
      throw error;
    }
  }, [user, dispatch, getLocalCart, saveToLocalStorage]);

  const updateQuantity = useCallback(async (productId, quantity) => {
    try {
      console.log(`🔄 Updating quantity for ${productId} to ${quantity}`);
      
      if (user) {
        // Optimistic update first
        dispatch(updateQuantityOptimistic({ productId, quantity }));
        
        // Then API call
        const result = await dispatch(updateCartQuantity({ productId, quantity })).unwrap();
        console.log('✅ Quantity updated successfully');
        return result;
      } else {
        // Guest user: update local storage
        const localCart = getLocalCart();
        const itemIndex = localCart.findIndex(item => item.productId === productId);
        
        if (itemIndex >= 0) {
          if (quantity === 0) {
            localCart.splice(itemIndex, 1);
          } else {
            localCart[itemIndex].quantity = quantity;
          }
          dispatch(loadFromLocalStorage(localCart));
        }
      }
    } catch (error) {
      console.error('❌ Error updating quantity:', error);
      const message = typeof error?.error === 'string' ? error.error : error?.message || 'Failed to update quantity';
      toast.error(message);
      throw error;
    }
  }, [user, dispatch, getLocalCart]);

  const removeFromCart = useCallback(async (productId) => {
    try {
      console.log(`🗑️ Removing ${productId} from cart`);
      // Prevent duplicate remove dispatches while one is in-flight for this item
      const pending = pendingOperations && pendingOperations[productId];
      if (pending && (pending === 'removing' || pending.type === 'removing')) {
        console.log('⏳ Remove already in progress for', productId);
        return;
      }
      
      if (user) {
        // Optimistic update first
        dispatch(removeFromCartOptimistic(productId));
        
        // Then API call
        const result = await dispatch(removeFromCartAction(productId)).unwrap();
        console.log('✅ Item removed successfully');
        return result;
      } else {
        // Guest user: update local storage
        const localCart = getLocalCart();
        const updatedCart = localCart.filter(item => item.productId !== productId);
        // 🛠️ FIX: Save updated cart to localStorage immediately
        localStorage.setItem(LOCAL_CART_KEY, JSON.stringify(updatedCart));
        dispatch(loadFromLocalStorage(updatedCart));
        console.log('✅ Guest cart item removed and saved to localStorage');
      }
    } catch (error) {
      console.error('❌ Error removing from cart:', error);
      const message = typeof error?.error === 'string' ? error.error : error?.message || 'Failed to remove from cart';
      toast.error(message);
      throw error;
    }
  }, [user, dispatch, getLocalCart]);

  const clearCart = useCallback(async (options) => {
    try {
      console.log('🧹 Clearing cart');
      
      if (user) {
        const result = await dispatch(clearCartAction(options)).unwrap();
        console.log('✅ Cart cleared successfully');
        return result;
      } else {
        // Guest user: clear local storage completely
        localStorage.removeItem(LOCAL_CART_KEY);
        localStorage.removeItem(CART_CACHE_KEY);
        localStorage.removeItem(CART_CACHE_TIMESTAMP_KEY);
        dispatch(loadFromLocalStorage([]));
        console.log('✅ Guest cart cleared completely');
      }
    } catch (error) {
      console.error('❌ Error clearing cart:', error);
      throw error;
    }
  }, [user, dispatch]);

  const refreshCart = useCallback(async () => {
    try {
      if (user) {
        console.log('🔄 Refreshing cart from database');
        const result = await dispatch(fetchCart()).unwrap();
        return result;
      }
    } catch (error) {
      console.error('❌ Error refreshing cart:', error);
      throw error;
    }
  }, [user, dispatch]);

  const clearCartError = useCallback(() => {
    dispatch(clearError());
  }, [dispatch]);

  // Computed values
  const isEmpty = cartItems.length === 0;
  const hasItems = cartItems.length > 0;
  
  const cartSummary = useMemo(() => ({
    itemCount: cartCount,
    totalPrice: cartTotal,
    isEmpty,
    hasItems
  }), [cartCount, cartTotal, isEmpty, hasItems]);

  const isOperationPending = useCallback((productId) => {
    const pending = pendingOperations[productId];
    if (!pending) return false;
    return typeof pending === 'string' ? true : Boolean(pending?.type);
  }, [pendingOperations]);

  return {
    // State
    cartItems,
    cartTotal,
    cartCount,
    isLoading,
    error,
    isOptimisticLoading,
    dbCartLoaded,
    isEmpty,
    hasItems,
    cartSummary,
    pendingOperations,

    // Actions
    addToCart,
    updateQuantity,
    removeFromCart,
    clearCart,
    refreshCart,
    clearCartError,

    // Helpers
    getItemQuantity,
    isItemInCart,
    getCartItem,
    isOperationPending,

    // Utilities (for debugging/advanced use)
    getLocalCart,
    getCachedCart
  };
};

export default useCart;