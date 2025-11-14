
const bcrypt = require('bcryptjs'); // Or 'bcrypt'

const userInputPassword = 'kishor0909'; 
const storedHashedPassword = '$2b$12$jA9HiISJSe3DlAKOqT1Hxe7nhp3LSRB2JaxISDmPHdOoOfsKByqX6'; // Example hash

bcrypt.compare(userInputPassword, storedHashedPassword, (err, result) => {
    if (err) {
        console.error('Error comparing passwords:', err);
        return;
    }
    
    if (result) {
        console.log('Passwords match! User authenticated.');
        // Proceed with login
    } else {
        console.log('Passwords do not match! Authentication failed.');
        // Return authentication failed message
    }
});