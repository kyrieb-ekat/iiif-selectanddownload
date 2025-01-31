import os
import re

# Define the directory containing the images
directory = "/Users/ekaterina/downloads/MS073/MS73 original"

# Text to replace and the new prefix
old_text = "_A_15th_century_Italian_antiphonal___manuscript"
new_prefix = "MS73"

# Iterate over each file in the directory
for filename in os.listdir(directory):
    # Match the number pattern in the filename using a regular expression
    match = re.search(rf"{re.escape(old_text)}__0_(\d+)_p\.__0", filename)
    if match:
        # Extract the number
        number = match.group(1)
        # Create the new filename
        new_name = f"{new_prefix}_{number}.jpg"  # Adjust the extension if needed
        # Get full paths for the files
        old_path = os.path.join(directory, filename)
        new_path = os.path.join(directory, new_name)
        # Rename the file
        os.rename(old_path, new_path)
        print(f"Renamed: {filename} -> {new_name}")

print("All done!")
