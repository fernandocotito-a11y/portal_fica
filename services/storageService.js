/* ============================================================================
   storageService.js — Capa de abstracción de persistencia
   ----------------------------------------------------------------------------
   Envuelve `localStorage` y `sessionStorage` con serialización JSON segura y
   tolerancia a fallos (p. ej. modo incógnito). Este es el único punto de
   acceso al almacenamiento: migrar a una API/BD real solo requiere reemplazar
   la implementación interna de este servicio, sin tocar el resto del código.
   ========================================================================== */

/** Lee y deserializa un valor; devuelve `fallback` si no existe o hay error. */
function read(engine, key, fallback = null) {
  try {
    const raw = engine.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Serializa y escribe un valor, ignorando errores de cuota/acceso. */
function write(engine, key, value) {
  try {
    engine.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Elimina una clave. */
function remove(engine, key) {
  try {
    engine.removeItem(key);
  } catch {
    /* noop */
  }
}

export const storageService = {
  /** Persistente (sobrevive al cierre del navegador). */
  local: {
    get(key, fallback = null) {
      return read(window.localStorage, key, fallback);
    },
    set(key, value) {
      return write(window.localStorage, key, value);
    },
    remove(key) {
      remove(window.localStorage, key);
    },
  },

  /** Solo durante la sesión (pestaña abierta). */
  session: {
    get(key, fallback = null) {
      return read(window.sessionStorage, key, fallback);
    },
    set(key, value) {
      return write(window.sessionStorage, key, value);
    },
    remove(key) {
      remove(window.sessionStorage, key);
    },
  },
};
