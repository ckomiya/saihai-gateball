# Reglas de gateball que implementa Saihai

🇬🇧 [Read in English](RULES.md)

Este documento describe, con palabras propias, qué reglas aplica el motor (`src/game/match.ts`) y cuáles son decisiones o simplificaciones de este proyecto.
Las referencias «Art. N» apuntan a los artículos del reglamento oficial de gateball (edición 2025, Unión Mundial de Gateball); allí está el texto completo. Aquí no se copia.
**Hecho** = está en el motor. **Propio** = decisión o interpretación nuestra. **No** = no se implementa.

## Cancha y bolas (Art. 1, 6)
- Cancha interior de 20 × 15 m. Las posiciones de las puertas y del poste están en `LAYOUT` (`src/config.ts`) y siguen la geometría del reglamento. **Hecho.**
- Área de salida de 1 × 3 m en la franja exterior, junto a la esquina 1. **Hecho.**
- Dos equipos de 5 bolas: rojas las impares, blancas las pares. Juegan alternadas en orden numérico. **Hecho.**
- La bola que llega al poste sale del juego; su jugador ya no juega. **Hecho.**
- Tamaños de bola, puerta y poste: **Propio** (medidas pensadas para verse bien en pantalla, no las del reglamento), en `config.ts`.

## Recorrido y puntos (Art. 7, 13, 14)
- Orden fijo: puerta 1 → puerta 2 → puerta 3 → poste. Cada puerta vale 1 punto; llegar al poste vale 2. Total 5 por bola. **Hecho.**
- Una puerta se pasa en su dirección y con la bola cruzando entera la línea de la puerta (se mide con el borde de la bola). **Hecho.**
- La puerta 1 se intenta con el tiro de salida. Si falla, la bola sale del campo y reintenta en su siguiente turno. **Hecho.**
- Una bola que pasa una puerta por un golpe de bola fuera no suma. **Hecho.**
- Se llega al poste golpeándolo con una bola en juego que ya pasó la puerta 3. **Hecho.**
- Gana quien tenga más puntos al final; con empate, empate. Los desempates por detalle y la ronda de la puerta 1: **No.**

## Golpe continuo (Art. 12)
- Un golpe que pasa una puerta y deja la bola quieta en juego da un golpe más; se encadena mientras cada golpe pase otra puerta. Varias puertas en un mismo golpe dan un solo golpe extra. **Hecho.**
- Un touch no da golpe continuo: da derecho a spark (ver abajo). **Hecho.**

## Touch (Art. 11, 15)
- Hay touch cuando una bola en juego (que ya pasó la puerta 1) toca a otra. **Hecho.**
- Si la bola que golpea aún no pasó la puerta 1 y mueve a otra, ese movimiento no vale y la otra vuelve a su sitio. **Hecho.**
- Las bolas que estorban el tiro de salida a la puerta 1 se vuelven «fantasma» (no chocan con la bola que sale) hasta que pase la puerta o cambie el turno. **Hecho** (el reglamento hace que el árbitro las aparte).
- Si el tiro de salida pasa la puerta 1 y luego choca con una bola, las bolas siguen su movimiento; no hay touch ni spark y el jugador gana el golpe continuo. **Propio.**
- Tocar dos veces la misma bola en un turno es falta: la bola movida vuelve y la que golpea queda fuera. **Hecho.**
- Una bola empujada por otra puede pasar una puerta o el poste y puntúa para su equipo; si es empujada fuera, queda como bola fuera. **Propio.**

## Spark (Art. 16)
- Tras un touch, la bola tocada se coloca pegada a la que golpea, del lado de la mira. **Propio** (el reglamento hace que el jugador la coloque a mano).
- La bola que golpea no se mueve: la fuerza y el rumbo van a la bola tocada, que puede pasar puertas, llegar al poste o salir. **Hecho.**
- Spark exitoso: la bola tocada termina con su borde a 10 cm o más de la que golpea, llega al poste o sale. Da un golpe más; dos si el touch y una puerta fueron del mismo golpe. **Hecho.**
- Spark fallido (corto, o la bola tocada queda en el campo exterior al golpear): todo vuelve a su sitio y la que golpea queda fuera. **Hecho.** Otras faltas del spark, como pisar la bola: **No.**
- Con varias bolas tocadas en un golpe, se sparkean una a una en el orden del touch. **Propio.**
- El spark va antes que el golpe continuo. **Hecho.**

## Bola fuera (Art. 17)
- Si una bola que ya pasó la puerta 1 sale de la cancha interior por un golpe válido, queda cerca de la línea, por donde cruzó (a 25 cm en el juego; el reglamento dice 10 cm, `outBallOffsetM`), y conserva los puntos que ganó en ese golpe. **Hecho.**
- La línea interior pertenece a la cancha: la bola está fuera cuando la cruza por completo. **Propio.**
- Se vuelve a golpear desde ahí en su siguiente turno; si entra, vuelve a ser bola en juego. Mientras esté fuera no puntúa. **Hecho.**
- Una bola que golpea desde fuera y toca otra comete falta: la otra vuelve y la que golpea queda fuera en el punto más cercano. **Hecho.**

## Reloj y fin del partido (Art. 5, 6, 7)
- Cuenta regresiva de 30 minutos, que corre más rápido que el real según `clockFactor`. **Propio.**
- Al acabarse el tiempo, o cuando un equipo llega a 25 puntos (juego perfecto), el partido termina con una bola blanca. Simplificación: si las blancas llegan a 25 por una jugada de una roja, también juega la blanca siguiente. **Propio.**
- Sorteo de quién sale primero (Art. 5): **Pendiente (fase futura)** (por ahora salen las rojas).
- Límite de 10 segundos por golpe: **No se aplica (decisión de diseño).**
