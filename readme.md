# Keycode
This project is a rework of Johnathan Westhues [Keycode From Photograph](https://cq.cx/key.html) page, 
which allows you to decipher the five or six digit code from a picture of a key. Right now it works with Schlage and Kwikset 5 and 6 pin keys, but more are planned for the future.

# Development notes
The main logic for getting the key code is in `key.js`, and needless to say, is quite messy.

I would love to refactor it into a better structure, where we can use some class `Keycode` to do the actual parsing, and have `index.js` handle the DOM and UI side of the app. Having a class like this would be quite useful, and could be translated into other languages, someday maybe even a CLI tool where the input is an image, and the output is your magic number for the key.


## Changes
-   Dark theme
-   Removed jquery (I think it was unneeded)
-   Minor improvements to structure
-   Arrow keys
    -   In the align tab, when you select "move", you can now move the key image around with the arrow keys, which makes it much easier to align the key in the photo with the markings. No more need to fiddle for 15 minutes with your mouse!