/* doorjam_arduino.ino
 * door opener closer program for Sudoroom / TheOmni
 * works with meatspace_firewall
 * https://github.com/sudoroom/doorjam
 * lisence:  GPL V3
 * by jerkey
 *
 * it runs a DC motor for a few seconds to lock or unlock the door,
 * and it watches the current so it can stop if the motor encounters a hard stop.
 */

// http://arduino.cc/en/Main/ArduinoMotorShieldR3
#define SPEAKER 5 // a beeper connected to pin 5 for happy/sad sounds
#define LED_DATA 2 // adafruit neopixel ws2811 ws2812 style LEDs (six)

#define SADTONE 200 // sad tone frequency
#define SADTIME 500 // sadtone time in milliseconds
#define HAPPYTONE 1000  // happy tone frequency
#define HAPPYTIME 500  // happy tone time in milliseconds

#define CHA_DIR 12
#define CHA_PWM 3
#define CHA_BRK 9
#define CHA_SENSE A0
#define CHB_DIR 13
#define CHB_PWM 11
#define CHB_BRK 8
#define CHB_SENSE A1

#define OPEN_TIME 14000 // milliseconds how long to run the motor
#define CLOSE_TIME 14000
#define OPEN_CURRENTMAX 140 // analogRead() value, not amps or anything
#define CLOSE_CURRENTMAX 140 // change this to 70 to be able to trip it by hand
#define MOTOR_START_TIME 150 // milliseconds before we start looking at current draw

#define LOCK_BTN_PIN 7
#define UNLOCK_BTN_PIN 4

#define AVG_CYCLES 50.0 // how many times to read analogRead and average reading

void setup() {
  Serial.begin(9600);
  Serial.println("Hello world, this is the door");
  pinMode(CHA_DIR,OUTPUT);
  pinMode(CHA_PWM,OUTPUT);
  pinMode(CHA_BRK,OUTPUT);
  pinMode(CHB_DIR,OUTPUT);
  pinMode(CHB_PWM,OUTPUT);
  pinMode(CHB_BRK,OUTPUT);
  digitalWrite(LOCK_BTN_PIN, HIGH); // enable internal pull-up resistor
  digitalWrite(UNLOCK_BTN_PIN, HIGH); // enable internal pull-up resistor
  pinMode(SPEAKER,OUTPUT);
}

int openButtonState = 0;
int closeButtonState = 0;

void loop() {
  if (Serial.available()) {  // if a byte appears on the serial port
    byte inByte = Serial.read();
    if (inByte == 'o') doorOpen();
    if (inByte == 'c') doorClose();
    if (inByte == 's') sadTone(); // use this when a card is rejected
    while (Serial.available()) { // read all bytes in the buffer until the the buffer is empty
      byte throwAway = Serial.read();
    }
  }

  if (!digitalRead(UNLOCK_BTN_PIN)) {
    openButtonState += 1;
    Serial.print("U");
  } else openButtonState = 0;

  if (!digitalRead(LOCK_BTN_PIN)) {
    closeButtonState += 1;
    Serial.print("L");
  } else closeButtonState = 0;
  
  if(openButtonState > 25) {
    doorOpen();
    openButtonState = 0;
  } else if(closeButtonState > 25) {
    doorClose();
    closeButtonState = 0;
  }

}

void doorOpen() {
  Serial.println("opening door!");
  happyTone(); // tone is not blocking
  digitalWrite(CHB_DIR,LOW);
  digitalWrite(CHB_PWM,HIGH); // turn motor on
  unsigned long now = millis();
  boolean overcurrent = false;
  while (millis() - now < OPEN_TIME && !overcurrent) {
    float current = 0;
    for (int i = 0; i < AVG_CYCLES; i++) current += analogRead(CHB_SENSE); // read a bunch of times
    current = current / AVG_CYCLES; // get the average current reading
    Serial.println(current);
    if ((millis() - now > MOTOR_START_TIME) && (current > OPEN_CURRENTMAX)) {
      overcurrent = true;
      Serial.println("overcurrent!");
    }
  }
  digitalWrite(CHB_PWM,LOW); // turn motor off
}

void doorClose() { // yes i know it should be one subroutine to open and close, sorry.
  Serial.println("closing!");
  happyTone(); // tone is not blocking
  digitalWrite(CHB_DIR,HIGH);
  digitalWrite(CHB_PWM,HIGH); // turn motor on
  unsigned long now = millis();
  boolean overcurrent = false;
  while (millis() - now < CLOSE_TIME && !overcurrent) {
    float current = 0;
    for (int i = 0; i < AVG_CYCLES; i++) current += analogRead(CHB_SENSE); // read a bunch of times
    current = current / AVG_CYCLES; // get the average current reading
    Serial.println(current);
    if ((millis() - now > MOTOR_START_TIME) && (current > CLOSE_CURRENTMAX)) {
      overcurrent = true;
      Serial.println("overcurrent!");
    }
  }
  digitalWrite(CHB_PWM,LOW); // turn motor off
  }

void happyTone() {
  tone (SPEAKER, HAPPYTONE, HAPPYTIME);
}

void sadTone() {
  tone (SPEAKER, SADTONE, SADTIME);
}
