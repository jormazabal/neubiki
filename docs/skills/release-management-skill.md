# Preparación de entregas de Neubiki

Aplica este procedimiento al cambiar la versión, los instaladores o los canales de actualización:

1. Alinea `VERSION` y los manifiestos. Revisa el alcance de la entrega y apunta las limitaciones en `CHANGELOG.md` y en `docs/releases/<versión>.md`.
2. Ejecuta la verificación apropiada y prepara los instaladores con el conector Proton. Identifica el commit, las plataformas y las firmas, y registra qué instalación o pruebas reales quedan pendientes.
3. Si se ha autorizado la publicación y los canales propios están configurados, sigue el [proceso de distribución](../development/release-process.md). No uses credenciales, firmas ni canales de otra aplicación.
